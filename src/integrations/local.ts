import { randomUUID } from 'node:crypto';
import { parseInput } from '../domain/policy.js';
import type { Input, Observation, Workflow } from '../domain/types.js';

export function approvedUrl(origin: string, path: string, input: Input) {
  parseInput(input);
  if (!['/catalog', '/quotes', '/quote-data'].includes(path))
    throw new Error('policy_rejected: route is not enrolled');
  const u = new URL(path, origin);
  if (u.origin !== origin || u.username || u.password)
    throw new Error('policy_rejected: origin mismatch');
  u.searchParams.set('sku', input.sku);
  u.searchParams.set('quantity', String(input.quantity));
  return u;
}
export async function safeRead(url: URL, origin: string, signal: AbortSignal) {
  if (
    url.origin !== origin ||
    !['/catalog', '/quotes', '/quote-data', '/health'].includes(url.pathname)
  )
    throw new Error('policy_rejected: request blocked before network');
  const response = await fetch(url, {
    redirect: 'manual',
    signal,
    headers: { Accept: 'text/html, application/json', 'User-Agent': 'GhostAPI-Local-Replay/0.1' },
  });
  if (response.status >= 300 && response.status < 400) throw new Error('blocked: redirect refused');
  if (response.status === 401 || response.status === 403)
    throw new Error('blocked: permission wall');
  if (response.status >= 500) throw new Error('transient: supplier unavailable');
  if (!response.ok) throw new Error('task_failed: supplier request failed');
  if (Number(response.headers.get('content-length') ?? 0) > 1024 * 1024)
    throw new Error('task_failed: response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('task_failed: empty response');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > 1024 * 1024) {
      await reader.cancel();
      throw new Error('task_failed: response too large');
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function executeLocal(
  workflow: Workflow,
  input: Input,
  timeout: number,
): Promise<{ id: string; observation: Observation }> {
  const id = `local-${randomUUID()}`;
  const url = approvedUrl(workflow.allowed_origin, workflow.start_path, input);
  const signal = AbortSignal.timeout(Math.max(1, timeout));
  const html = await safeRead(url, workflow.allowed_origin, signal);
  const encoded = /<pre id="quote-observation" data-format="json">([^]*?)<\/pre>/.exec(html)?.[1];
  if (!encoded) throw new Error('schema_drift: quotation data missing');
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  let raw = JSON.parse(decode(encoded));
  let source = url;
  if (workflow.goal_clause_ids.includes('FOLLOW_APPROVED_JSON_VIEW') && raw.outcome === 'quote') {
    source = approvedUrl(workflow.allowed_origin, '/quote-data', input);
    raw = JSON.parse(await safeRead(source, workflow.allowed_origin, signal));
  }
  // Fixed typed projection; page text never becomes an executable instruction.
  const fields = [
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
    'reason_code',
    ...(workflow.observed_schema_id === 'QUOTE_OR_UNAVAILABLE_WF2'
      ? [
          'price_basis',
          'unit_price_ex_tax_paise',
          'demo_tax_rate_numerator',
          'demo_tax_rate_denominator',
          'tax_amount_paise',
        ]
      : []),
  ];
  const observation = Object.fromEntries(
    fields.filter((key) => key in raw).map((key) => [key, raw[key]]),
  );
  return {
    id,
    observation: {
      ...observation,
      source_url: source.toString(),
      observed_at: new Date().toISOString(),
      evidence_ids: [id],
    } as Observation,
  };
}
