import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.js';
import { GhostService, safeError } from './service.js';
import { createPortal } from './portal/app.js';
import { tinyfishReadiness } from './integrations/tinyfish.js';
import { applyPatch } from './domain/policy.js';
import { validateObservation } from './domain/validator.js';

function listen(app: express.Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.on('error', reject);
  });
}
export async function startRuntime(
  options: { dashboardPort?: number; portalPort?: number; dataDir?: string; host?: string } = {},
) {
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  // The control plane intentionally never binds publicly. Deploy the portal
  // separately for remote execution; never expose release/reset APIs with it.
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new Error('Dashboard control plane must bind loopback.');
  let store: Store | undefined;
  const portal = createPortal(() => store?.state.release ?? 'r1', '');
  const portalServer = await listen(
    portal,
    options.portalPort ?? Number(process.env.PORTAL_PORT ?? 3001),
    host,
  );
  const portalAddress = portalServer.address();
  if (!portalAddress || typeof portalAddress === 'string')
    throw new Error('Portal address unavailable');
  const portalOrigin = `http://127.0.0.1:${portalAddress.port}`;
  const stateStore = new Store(
    resolve(options.dataDir ?? process.env.DATA_DIR ?? './data'),
    portalOrigin,
  );
  store = stateStore;
  try {
    await store.load();
  } catch (err) {
    portalServer.close();
    throw err;
  }
  const service = new GhostService(store, portalOrigin);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hostname = (req.headers.host ?? '').split(':')[0] ?? '';
    if (!['127.0.0.1', 'localhost', '['].includes(hostname)) {
      res.status(403).json({ error: 'Untrusted Host' });
      return;
    }
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (
        req.headers['x-ghostapi-client'] !== 'dashboard' ||
        (origin && origin !== `http://${req.headers.host}`)
      ) {
        res.status(403).json({ error: 'Control request rejected: use the local dashboard.' });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: '3mb' }));
  app.get('/api/state', (_req, res) => {
    const snapshot = structuredClone(service.state);
    if (snapshot.cycle && Date.now() >= snapshot.cycle.deadline) {
      snapshot.cycle.status = 'expired';
      snapshot.health = snapshot.health === 'Blocked' ? 'Blocked' : 'Degraded';
      delete snapshot.published;
    }
    res.json({
      state: snapshot,
      busy: service.busy,
      portal_origin: portalOrigin,
      capabilities: {
        executor: 'local-http',
        tinyfish: tinyfishReadiness(),
        planner: {
          configured: Boolean(
            process.env.OPENAI_API_KEY &&
            process.env.OPENAI_MODEL &&
            Number(process.env.PLANNER_MAX_COST_USD) > 0,
          ),
          model: process.env.OPENAI_MODEL ?? null,
        },
        rea: {
          package: 'rea-agents@6.7.0',
          mode: 'caller-supplied sanitized HAR; actual success recorded per evidence item',
        },
        ablation: {
          status: 'not_run',
          reason: 'No controlled LLM/TinyFish contribution comparison has been executed.',
        },
      },
    });
  });
  const action = (path: string, fn: (body: Record<string, unknown>) => Promise<unknown>) =>
    app.post(path, async (req, res) => {
      try {
        const result = await service.exclusive(() => fn(req.body ?? {}));
        res.json({ ok: true, result });
      } catch (err) {
        const error = safeError(err);
        res.status(error.startsWith('busy:') ? 409 : 400).json({ error });
      }
    });
  action('/api/baseline', () => service.baseline());
  action('/api/release', (body) => service.switchRelease(body.release as 'r1' | 'r2'));
  action('/api/quote', (body) => service.quote(body));
  action('/api/inspect', (body) => service.inspect(body.har));
  action('/api/propose', (body) => service.propose(body.use_llm === true));
  action('/api/verify', (body) => service.verify(String(body.id)));
  action('/api/promote', (body) => service.promote(String(body.id)));
  action('/api/rollback', () => service.rollback());
  action('/api/reset', () => service.reset());
  action('/api/demo', (body) => service.demo(body.use_llm === true));
  action('/api/reject-bad-patch', async () => {
    const before = service.state.active_version;
    let rejected = false;
    try {
      applyPatch(
        service.active,
        {
          from_version: before,
          candidate_version: 999,
          changes: { mode: 'write' },
          rea_evidence_ids: [],
        },
        [],
        999,
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('Unexpected unsafe patch acceptance');
    store!.event(
      'success',
      'Unsafe patch rejected',
      'Write-mode injection rejected before execution; active pointer unchanged.',
    );
    await store!.save();
    return { rejected, active_unchanged: service.state.active_version === before };
  });
  action('/api/reject-bad-result', async () => {
    const candidate = service.state.candidates.findLast((c) =>
      c.tests.some((t) => t.observation?.outcome === 'quote'),
    );
    const run = candidate?.tests.find((t) => t.observation?.outcome === 'quote');
    if (!candidate || !run?.observation || !service.state.cycle)
      throw new Error('Run candidate verification before testing incorrect tax.');
    const raw = structuredClone(run.observation);
    raw.tax_amount_paise!--;
    raw.reported_total_paise!--;
    const validation = validateObservation(
      raw,
      candidate.workflow,
      run.input,
      service.state.release,
      [run.id],
      Date.parse(service.state.cycle.started_at),
    );
    const rejected = !validation.result;
    store!.event(
      rejected ? 'success' : 'error',
      'Incorrect tax challenge',
      rejected ? 'Internally consistent but incorrect tax was rejected.' : 'Unexpected acceptance.',
    );
    await store!.save();
    return { rejected, checks: validation.checks };
  });
  app.post('/api/tinyfish', (_req, res) =>
    res.status(409).json({ error: tinyfishReadiness().reason }),
  );
  app.get('/api/export', (_req, res) => {
    res.attachment(`ghostapi-audit-${Date.now()}.json`).json({
      exported_at: new Date().toISOString(),
      execution_mode: 'local-http',
      state: service.state,
      tinyfish: tinyfishReadiness(),
      ablation: 'not_run',
    });
  });
  app.use(express.static(resolve('public')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) =>
    res.status(400).json({ error: safeError(err) }),
  );
  let dashboardServer: Server;
  try {
    dashboardServer = await listen(
      app,
      options.dashboardPort ?? Number(process.env.PORT ?? 3000),
      host,
    );
  } catch (err) {
    portalServer.close();
    throw err;
  }
  const addr = dashboardServer.address();
  if (!addr || typeof addr === 'string') throw new Error('Dashboard address unavailable');
  return {
    service,
    app,
    portal,
    dashboardServer,
    portalServer,
    url: `http://127.0.0.1:${addr.port}`,
    portalOrigin,
    close: async () => {
      for (const s of [dashboardServer, portalServer]) {
        s.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          s.close((err) => (err ? reject(err) : resolve())),
        );
      }
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const runtime = await startRuntime();
  console.log(
    `GhostAPI dashboard: ${runtime.url}\nRead-only supplier: ${runtime.portalOrigin}\nMode: local HTTP replay. TinyFish remote execution is blocked pending an enforced execution boundary.`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => void runtime.close().then(() => process.exit(0)));
}
