import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type CaptureRequest = { url: string; mime: string; size: number; sha256: string };
export type CloneEvidence = {
  status: 'verified' | 'unavailable';
  evidence_id?: string;
  sha256?: string;
  requests: { url: string; method: string; mime: string; kind: string }[];
  limitations: string[];
};
export function captureRequest(url: string, mime: string, body: string): CaptureRequest {
  const clean = new URL(url);
  clean.username = '';
  clean.password = '';
  clean.search = '';
  clean.hash = '';
  return {
    url: clean.href,
    mime: mime.split(';')[0]!,
    size: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}
export async function inspectCloneCapture(
  requests: CaptureRequest[],
  dir: string,
  provenance: 'http' | 'browser-response' = 'http',
): Promise<CloneEvidence> {
  const entries = requests.slice(0, 100).map((request) => ({
    startedDateTime: new Date().toISOString(),
    time: 0,
    request: {
      method: 'GET',
      url: request.url,
      httpVersion: 'HTTP/1.1',
      headers: [],
      cookies: [],
      queryString: [],
      headersSize: -1,
      bodySize: 0,
    },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [],
      cookies: [],
      content: { mimeType: request.mime, size: request.size },
      redirectURL: '',
      headersSize: -1,
      bodySize: request.size,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
  }));
  const text = JSON.stringify({
    log: {
      version: '1.2',
      creator: {
        name:
          provenance === 'http'
            ? 'GhostAPI clone HTTP capture — not browser traffic'
            : 'GhostAPI browser response events through guarded public transport',
        version: '1',
      },
      entries,
    },
  });
  const sha256 = createHash('sha256').update(text).digest('hex');
  const folder = join(dir, 'captures');
  await mkdir(folder, { recursive: true });
  const name = `clone-${randomUUID()}`;
  const path = join(folder, `${name}.har`);
  await writeFile(path, text, { mode: 0o600 });
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      resolve('node_modules/rea-agents/scripts/rea.mjs'),
      'inspect-web-network-capture',
      path,
      'har',
      '--json',
    ],
    {
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  const result = JSON.parse(stdout) as {
    error?: unknown;
    evidence_id?: string;
    normalized_result?: {
      artifact?: { sha256?: string };
      records?: {
        reported?: {
          request?: { method?: string; url?: string };
          response?: { content?: { mimeType?: string } };
        };
      }[];
    };
  };
  if (result.error || !result.evidence_id || result.normalized_result?.artifact?.sha256 !== sha256)
    throw new Error('REA capture digest or evidence identity could not be verified.');
  const verified = new Map(requests.map((request) => [request.url, request]));
  const normalized = (result.normalized_result.records ?? []).flatMap((record) => {
    const request = record.reported?.request;
    if (request?.method !== 'GET' || !request.url || !verified.has(request.url)) return [];
    const mime = record.reported?.response?.content?.mimeType;
    if (!mime || mime !== verified.get(request.url)!.mime) return [];
    const kind = /json/i.test(mime)
      ? 'json'
      : /html/i.test(mime)
        ? 'document'
        : /css/i.test(mime)
          ? 'stylesheet'
          : /^image\//i.test(mime)
            ? 'image'
            : /^font\//i.test(mime)
              ? 'font'
              : 'resource';
    return [{ url: request.url, method: 'GET', mime, kind }];
  });
  if (!normalized.length || normalized.length !== entries.length)
    throw new Error('REA did not preserve the captured request inventory.');
  await writeFile(join(folder, `${name}.rea.json`), JSON.stringify(result), { mode: 0o600 });
  return {
    status: 'verified',
    evidence_id: result.evidence_id,
    sha256,
    requests: normalized,
    limitations: [
      provenance === 'http'
        ? 'REA inspected a caller-supplied HAR of successful clone HTTP reads. This is not browser/CDP traffic.'
        : 'REA inspected a sanitized HAR derived from browser response events after the selected interaction. Responses were supplied by the guarded public transport; this is not unrestricted source traffic.',
      'Headers, cookies, query values and response bodies are omitted. Asset sizes describe the captured string representation.',
      'DOM field bindings are extraction rules; asset requests do not prove the existence of a source data API.',
    ],
  };
}
