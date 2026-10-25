import { randomUUID } from 'node:crypto';
import type { Cycle, Release } from './types.js';

export function newCycle(
  release: Release,
  generation: number,
  limitUsd = 1,
  now = Date.now(),
): Cycle {
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) throw new Error('invalid cycle budget');
  return {
    id: randomUUID(),
    started_at: new Date(now).toISOString(),
    deadline: now + 360000,
    runs: 0,
    reserved_usd: 0,
    limit_usd: limitUsd,
    status: 'active',
    release,
    generation,
  };
}
export function assertCycle(cycle: Cycle, release: Release, now = Date.now()) {
  if (cycle.status !== 'active' || now >= cycle.deadline)
    throw new Error('budget_exhausted: cycle expired');
  if (release !== cycle.release) throw new Error('stale_release: site changed during cycle');
}
export function reserve(
  cycle: Cycle,
  release: Release,
  costUsd: number,
  countsRun = true,
  now = Date.now(),
) {
  assertCycle(cycle, release, now);
  if (!Number.isFinite(costUsd) || costUsd < 0)
    throw new Error('budget_exhausted: unknown charge bound');
  if (countsRun && cycle.runs >= 15) throw new Error('budget_exhausted: run limit');
  if (cycle.reserved_usd + costUsd > cycle.limit_usd + 1e-10)
    throw new Error('budget_exhausted: spend cap');
  cycle.reserved_usd += costUsd;
  if (countsRun) cycle.runs++;
  return Math.min(120000, cycle.deadline - now);
}
