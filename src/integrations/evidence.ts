import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseInput } from '../domain/policy.js';
import { approvedUrl, safeRead } from './local.js';
import type { Evidence, Input, Release } from '../domain/types.js';

const exec = promisify(execFile);
const fields = new Set([
  'outcome',
  'sku',
  'quantity',
  'currency',
  'site_release',
  'quote_id',
  'displayed_price_paise',
  'basis_label_text',
  'delivery_fee_paise',
  'reported_total_paise',
  'price_basis',
  'unit_price_ex_tax_paise',
  'demo_tax_rate_numerator',
  'demo_tax_rate_denominator',
  'tax_amount_paise',
  'reason_code',
]);
export async function localHar(origin: string, input: Input, timeout: number): Promise<unknown> {
  const url = approvedUrl(origin, '/quote-data', input);
  const start = new Date().toISOString();
  const text = await safeRead(url, origin, AbortSignal.timeout(Math.max(1, timeout)));
  return {
    log: {
      version: '1.2',
      creator: { name: 'GhostAPI local HTTP inspector (not browser capture)', version: '0.1' },
      entries: [
        {
          startedDateTime: start,
          time: Date.now() - Date.parse(start),
          request: {
            method: 'GET',
            url: url.toString(),
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [],
            queryString: [...url.searchParams].map(([name, value]) => ({ name, value })),
            headersSize: -1,
            bodySize: 0,
          },
          response: {
            status: 200,
            statusText: 'OK',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: { mimeType: 'application/json', size: Buffer.byteLength(text), text },
            redirectURL: '',
            headersSize: -1,
            bodySize: Buffer.byteLength(text),
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        },
      ],
    },
  };
}
export function sanitizeHar(
  raw: unknown,
  origin: string,
  release: Release,
  notBefore: number,
  kind: 'local-http' | 'operator-har',
) {
  if (!raw || typeof raw !== 'object' || !('log' in raw))
    throw new Error('unknown: HAR log missing');
  const log = (raw as { log?: { entries?: unknown[] } }).log;
  if (!log || !Array.isArray(log.entries) || log.entries.length > 1000)
    throw new Error('unknown: invalid HAR entries');
  const retained: object[] = [];
  const paths = new Set<string>(),
    observedFields = new Set<string>();
  let input: Input | undefined;
  for (const item of log.entries) {
    if (!item || typeof item !== 'object') continue;
    const e = item as {
      startedDateTime?: string;
      request?: { method?: string; url?: string };
      response?: {
        status?: number;
        content?: { text?: string; mimeType?: string; encoding?: string };
      };
    };
    let u: URL;
    try {
      u = new URL(e.request?.url ?? '');
    } catch {
      continue;
    }
    if (
      u.origin !== origin ||
      u.pathname !== '/quote-data' ||
      e.request?.method !== 'GET' ||
      e.response?.status !== 200 ||
      u.username ||
      u.password ||
      u.hash
    )
      continue;
    if ([...u.searchParams.keys()].some((k) => !['sku', 'quantity'].includes(k))) continue;
    const captured = Date.parse(e.startedDateTime ?? '');
    if (!Number.isFinite(captured) || captured < notBefore || captured > Date.now() + 2000)
      continue;
    const content = e.response.content;
    if (
      !content?.text ||
      !/json/i.test(content.mimeType ?? '') ||
      content.text.length > 1024 * 1024
    )
      continue;
    if (content.encoding && content.encoding !== 'base64') continue;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(
        content.encoding === 'base64'
          ? Buffer.from(content.text, 'base64').toString('utf8')
          : content.text,
      );
    } catch {
      continue;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.site_release !== release)
      continue;
    const parsed = parseInput({ sku: body.sku, quantity: body.quantity });
    if (
      u.searchParams.get('sku') !== parsed.sku ||
      u.searchParams.get('quantity') !== String(parsed.quantity)
    )
      throw new Error('unknown: capture input mismatch');
    if (input && (input.sku !== parsed.sku || input.quantity !== parsed.quantity))
      throw new Error('unknown: select one SKU/quantity capture');
    input = parsed;
    const projected = Object.fromEntries(Object.entries(body).filter(([key]) => fields.has(key)));
    Object.keys(projected).forEach((key) => observedFields.add(key));
    paths.add(u.pathname);
    const text = JSON.stringify(projected);
    retained.push({
      startedDateTime: new Date(captured).toISOString(),
      time: 0,
      request: {
        method: 'GET',
        url: u.toString(),
        httpVersion: 'HTTP/1.1',
        headers: [],
        cookies: [],
        queryString: [...u.searchParams].map(([name, value]) => ({ name, value })),
        headersSize: -1,
        bodySize: 0,
      },
      response: {
        status: 200,
        statusText: 'OK',
        httpVersion: 'HTTP/1.1',
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        cookies: [],
        content: { mimeType: 'application/json', size: Buffer.byteLength(text), text },
        redirectURL: '',
        headersSize: -1,
        bodySize: Buffer.byteLength(text),
      },
      cache: {},
      timings: { send: 0, wait: 0, receive: 0 },
    });
  }
  if (!input || !retained.length)
    throw new Error('unknown: no fresh, input-bound current-release quote JSON body in HAR');
  const sanitized = {
    log: {
      version: '1.2',
      creator: { name: 'GhostAPI sanitized quote projection', version: '0.1' },
      entries: retained,
    },
  };
  const text = JSON.stringify(sanitized);
  const evidence: Evidence = {
    id: `${kind}-${randomUUID()}`,
    kind,
    created_at: new Date().toISOString(),
    release,
    origin,
    input,
    sha256: createHash('sha256').update(text).digest('hex'),
    paths: [...paths],
    fields: [...observedFields],
    limitations: [
      'Only selected same-origin GET quote records retained; not a complete network capture.',
      'Headers, cookies, unrelated records and unknown body fields removed.',
      'Local HTTP capture is not TinyFish browser execution or operator browser export.',
    ],
  };
  return { text, evidence };
}
export async function inspectWithRea(
  text: string,
  evidence: Evidence,
  dataDir: string,
  timeout: number,
): Promise<Evidence> {
  const cli = resolve('node_modules/rea-agents/scripts/rea.mjs');
  await access(cli);
  const folder = join(dataDir, 'captures');
  await mkdir(folder, { recursive: true });
  const path = join(folder, `${evidence.id}.har`);
  await writeFile(path, text, { mode: 0o600 });
  const { stdout } = await exec(
    process.execPath,
    [cli, 'inspect-web-network-capture', path, 'har', '--json'],
    {
      timeout: Math.min(30000, timeout),
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('unknown: REA did not return parseable JSON');
  }
  if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error)
    throw new Error('unknown: REA refused supplied capture');
  // Derive the planner's field/path finding from REA's actual normalized
  // records, not from the input parser while merely attaching a REA badge.
  const result = parsed as {
    evidence_id?: string;
    normalized_result?: {
      artifact?: { sha256?: string };
      records?: {
        reported?: {
          request?: { method?: string; url?: string };
          response?: { content?: { text?: string } };
        };
      }[];
    };
  };
  if (result.normalized_result?.artifact?.sha256 !== evidence.sha256 || !result.evidence_id)
    throw new Error('unknown: REA artifact digest or evidence identity missing');
  const reaFields = new Set<string>(),
    reaPaths = new Set<string>();
  for (const record of result.normalized_result.records ?? []) {
    const request = record.reported?.request;
    if (request?.method !== 'GET' || !request.url) continue;
    const u = new URL(request.url);
    if (u.origin !== evidence.origin || u.pathname !== '/quote-data') continue;
    const body = JSON.parse(record.reported?.response?.content?.text ?? 'null');
    if (
      !body ||
      body.sku !== evidence.input.sku ||
      body.quantity !== evidence.input.quantity ||
      body.site_release !== evidence.release
    )
      throw new Error('unknown: REA normalized response identity mismatch');
    Object.keys(body)
      .filter((k) => fields.has(k))
      .forEach((k) => reaFields.add(k));
    reaPaths.add(u.pathname);
  }
  if (!reaFields.size || !reaPaths.size)
    throw new Error('unknown: REA normalized response body unavailable');
  // Keep bounded typed findings, not arbitrary tool output, in planner context.
  await writeFile(join(folder, `${evidence.id}.rea.json`), JSON.stringify(parsed, null, 2), {
    mode: 0o600,
  });
  return {
    ...evidence,
    kind: 'rea-har',
    id: result.evidence_id,
    fields: [...reaFields],
    paths: [...reaPaths],
    rea_output: `${evidence.id}.rea.json`,
    limitations: [
      ...evidence.limitations,
      'REA inspected this caller-supplied sanitized HAR; no claim of passive CDP value capture.',
    ],
  };
}
