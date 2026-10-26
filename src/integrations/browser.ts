import { TinyFish } from '@tiny-fish/sdk';
import { createHash } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { approvedUrl, projectObservation, safeRead } from './local.js';
import type { Input, Workflow } from '../domain/types.js';

export type BrowserLifecycle = {
  opened: (id: string) => Promise<void>;
  closed: (id: string) => Promise<void>;
};
let cachedRate: { key: string; rate: number; asOf: string; expires: number } | undefined;

export async function browserReservation(timeout: number) {
  if (!process.env.TINYFISH_API_KEY) throw new Error('TinyFish credential is not configured.');
  const client = new TinyFish({ maxRetries: 0, timeout: 15000 });
  const key = createHash('sha256').update(process.env.TINYFISH_API_KEY).digest('hex');
  let wallet = await client.wallet.get();
  let meter = wallet.rates?.meters.find((m) => m.label === 'TinyFish Browser');
  // The wallet contract explicitly permits rates:null. A brief missing-rate
  // response is not a price change; use only a recently verified same-key rate.
  if (!meter && (!cachedRate || cachedRate.key !== key || cachedRate.expires < Date.now())) {
    wallet = await client.wallet.get();
    meter = wallet.rates?.meters.find((m) => m.label === 'TinyFish Browser');
  }
  if (meter) {
    const value = Number(meter.unit_amount);
    if (meter.currency !== 'USD' || meter.per !== 'minute' || !Number.isFinite(value) || value < 0)
      throw new Error('Unknown TinyFish browser billing contract.');
    cachedRate = { key, rate: value, asOf: wallet.rates!.as_of, expires: Date.now() + 5 * 60000 };
  }
  if (!cachedRate || cachedRate.key !== key || cachedRate.expires < Date.now())
    throw new Error('Browser rate is unavailable; no billed session started.');
  const rate = cachedRate.rate;
  // Includes creation/connection time, local deadline and inactivity fallback.
  const upper = rate * (Math.ceil((Math.min(timeout, 120000) * 2 + 60000) / 60000) + 1);
  if (
    wallet.currency !== 'USD' ||
    !Number.isFinite(Number(wallet.available_balance)) ||
    Number(wallet.available_balance) < upper
  )
    throw new Error('Insufficient or unknown TinyFish balance for the reserved browser run.');
  return { reserved_usd: upper, rate_usd_per_minute: rate, rate_as_of: cachedRate.asOf };
}

export async function installReadOnlyBridge(
  context: BrowserContext,
  workflow: Workflow,
  input: Input,
  timeout: number,
) {
  let denied = 0;
  const signal = AbortSignal.timeout(Math.max(1, timeout));
  await context.routeWebSocket('**/*', (socket) => {
    denied++;
    socket.close();
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      denied++;
      await route.abort('blockedbyclient');
      return;
    }
    if (
      url.origin === workflow.allowed_origin &&
      url.pathname === '/favicon.ico' &&
      request.method() === 'GET'
    ) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const enrolled =
      ['/catalog', '/quotes', '/quote-data'].includes(url.pathname) &&
      url.origin === workflow.allowed_origin &&
      !url.username &&
      !url.password &&
      !url.hash &&
      request.method() === 'GET' &&
      url.searchParams.getAll('sku').length === 1 &&
      url.searchParams.get('sku') === input.sku &&
      url.searchParams.getAll('quantity').length === 1 &&
      url.searchParams.get('quantity') === String(input.quantity) &&
      [...url.searchParams.keys()].every((key) => ['sku', 'quantity'].includes(key));
    if (!enrolled) {
      denied++;
      await route.abort('blockedbyclient');
      return;
    }
    try {
      // The remote browser never receives arbitrary network access through this
      // controller. Every permitted GET is fetched from the enrolled source.
      const text = await safeRead(url, workflow.allowed_origin, signal);
      await route.fulfill({
        status: 200,
        contentType: url.pathname === '/quote-data' ? 'application/json' : 'text/html',
        body: text,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        },
      });
    } catch {
      denied++;
      await route.abort('failed');
    }
  });
  return { denied: () => denied };
}

export async function readBrowserQuote(
  page: Page,
  workflow: Workflow,
  input: Input,
  timeout: number,
  id: string,
) {
  let source = approvedUrl(workflow.allowed_origin, workflow.start_path, input);
  await page.goto(source.toString(), { waitUntil: 'domcontentloaded', timeout });
  const text = await page.locator('#quote-observation').textContent({ timeout });
  if (!text) throw new Error('schema_drift: quotation DOM record missing');
  let raw = JSON.parse(text);
  if (workflow.goal_clause_ids.includes('FOLLOW_APPROVED_JSON_VIEW') && raw.outcome === 'quote') {
    source = approvedUrl(workflow.allowed_origin, '/quote-data', input);
    await page.goto(source.toString(), { waitUntil: 'domcontentloaded', timeout });
    raw = JSON.parse(await page.locator('body').innerText({ timeout }));
  }
  return { id, observation: projectObservation(raw, workflow, id, source) };
}

export async function closeTinyfishSession(id: string) {
  const response = await fetch(`https://api.browser.tinyfish.ai/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': process.env.TINYFISH_API_KEY ?? '' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (response.status !== 204)
    throw new Error(`Browser cleanup not confirmed (HTTP ${response.status}).`);
}

export async function executeBrowser(
  workflow: Workflow,
  input: Input,
  timeout: number,
  lifecycle: BrowserLifecycle,
) {
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1, deadline - Date.now());
  const client = new TinyFish({ maxRetries: 0, timeout: Math.min(timeout, 60000) });
  let id: string | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    const session = await client.browser.sessions.create({
      timeout_seconds: 120,
      proxy_config: { enabled: false },
    });
    id = session.session_id;
    await lifecycle.opened(id);
    // The CDP URL is an ephemeral credential: never persist, expose or log it.
    browser = await chromium.connectOverCDP(session.cdp_url, { timeout: remaining() });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    const guard = await installReadOnlyBridge(context, workflow, input, remaining());
    const page = await context.newPage();
    const result = await readBrowserQuote(page, workflow, input, remaining(), id);
    if (guard.denied() > 0) throw new Error('blocked: remote page attempted an unenrolled request');
    return result;
  } catch (error) {
    if (error instanceof Error && /^(blocked:|schema_drift:|policy_rejected:)/.test(error.message))
      throw error;
    throw new Error(
      `Remote browser execution failed (${error instanceof Error ? error.name : 'unknown'}); session credentials suppressed.`,
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (id) {
      // Browser disconnection alone does not stop billing.
      await closeTinyfishSession(id);
      await lifecycle.closed(id);
    }
  }
}
