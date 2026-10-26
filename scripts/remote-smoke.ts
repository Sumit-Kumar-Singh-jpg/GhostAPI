import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { startRuntime } from '../src/server.js';

const full = process.argv.includes('--full');
const ai = process.argv.includes('--ai'),
  comparison = process.argv.includes('--compare');
const folder = resolve('data', 'remote-checks', `${Date.now()}-${randomUUID()}`);
const runtime = await startRuntime({ dashboardPort: 0, portalPort: 0, dataDir: folder });
try {
  await runtime.service.exclusive(() => runtime.service.setExecutor('tinyfish-browser'));
  if (ai) await runtime.service.exclusive(() => runtime.service.setBudget(comparison ? 6 : 3));
  if (full) await runtime.service.exclusive(() => runtime.service.demo(ai));
  else await runtime.service.exclusive(() => runtime.service.baseline());
  if (comparison) await runtime.service.exclusive(() => runtime.service.evaluate(ai));
  const state = runtime.service.state;
  const report = {
    at: new Date().toISOString(),
    scope: full ? 'full-remote-browser-cycle' : 'remote-browser-baseline',
    health: state.health,
    executor: state.executor,
    active_version: state.active_version,
    verified_total_paise: state.published?.verified_total_paise,
    runs: state.runs.map((r) => ({
      id: r.id,
      status: r.status,
      executor: r.executor,
      passed: Boolean(r.result),
      failed_checks: r.checks.filter((c) => !c.pass),
      error: r.error,
    })),
    reserved_usd: state.cycle?.reserved_usd,
    outstanding_sessions: state.outstanding,
    rea: state.evidence.at(-1)?.kind,
    planner: state.candidates.at(-1)?.planner,
    planner_receipt: state.candidates.at(-1)?.planner_receipt,
    comparison: state.evaluations?.at(-1),
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts', 'remote-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (state.health !== 'Healthy' || state.outstanding.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Remote smoke failed');
  process.exitCode = 1;
} finally {
  await runtime.close();
}
