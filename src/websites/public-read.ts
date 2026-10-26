import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';

export type PublicPage = { url: string; body: string; contentType: string };
export function publicUrl(value: string): URL {
  if (value.length > 2048) throw new Error('Website URL is too long.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password)
    throw new Error('Use a public HTTPS URL without credentials or a custom port.');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(url.hostname))
    throw new Error('Private network destinations are not supported.');
  if (
    [...url.searchParams.keys()].some((k) =>
      /token|secret|password|api.?key|authorization|session/i.test(k),
    )
  )
    throw new Error('Use a public URL without authentication parameters.');
  url.hash = '';
  return url;
}
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
// Resolve and pin the address used by the TLS connection. Every redirect gets
// its own validation; DNS rebinding cannot redirect the socket to a private IP.
export async function readPublicPage(value: string): Promise<PublicPage> {
  let url = publicUrl(value);
  const signal = AbortSignal.timeout(20000);
  for (let redirect = 0; redirect < 5; redirect++) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('Website lookup timed out.'));
        else
          signal.addEventListener('abort', () => reject(new Error('Website lookup timed out.')), {
            once: true,
          });
      }),
    ]);
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error('Website resolves to a private or reserved network address.');
    const pinned = addresses[0]!;
    const response = await new Promise<{
      status: number;
      location?: string;
      body: string;
      contentType: string;
    }>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          signal,
          family: pinned.family,
          lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
          headers: {
            Accept: 'text/html, application/json',
            'Accept-Encoding': 'identity',
            'User-Agent': 'GhostAPI-Website-Monitor/0.3',
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.destroy();
            resolve({ status, location: res.headers.location, body: '', contentType: '' });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024)
              res.destroy(new Error('Page exceeds the 2 MB inspection limit.'));
            else chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () =>
            resolve({
              status,
              body: Buffer.concat(chunks).toString('utf8'),
              contentType: String(res.headers['content-type'] ?? ''),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
    if (response.status >= 300 && response.status < 400 && response.location) {
      url = publicUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status !== 200)
      throw new Error(
        `Website returned HTTP ${response.status}. Login walls and blocked pages cannot be inspected.`,
      );
    if (!/text\/html|application\/(?:ld\+)?json/i.test(response.contentType))
      throw new Error('This page does not provide HTML or JSON data.');
    return { url: url.href, body: response.body, contentType: response.contentType };
  }
  throw new Error('Website redirects too many times.');
}
