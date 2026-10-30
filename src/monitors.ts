import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type MonitorTarget =
  | { kind: 'shopping' | 'internships'; request_id: string }
  | { kind: 'source_api'; website_id: string; candidate_id: string };
export type Observation = { label: string; values: Record<string, string> };
export type LocalMonitor = {
  id: string;
  target: MonitorTarget;
  label: string;
  enabled: boolean;
  interval_minutes: number;
  next_at: string;
  last_at?: string;
  phase: 'idle' | 'checking';
  status: 'ready' | 'unchanged' | 'changed' | 'error';
  values: Record<string, string>;
  history: {
    at: string;
    status: string;
    message: string;
    changes: { field: string; before?: string; after?: string }[];
  }[];
};
export function monitorTarget(value: unknown): MonitorTarget {
  if (!value || typeof value !== 'object') throw new Error('Select a saved result to monitor.');
  const input = value as Record<string, unknown>;
  const id = (value: unknown) => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value);
  if ((input.kind === 'shopping' || input.kind === 'internships') && id(input.request_id))
    return { kind: input.kind, request_id: String(input.request_id) };
  if (input.kind === 'source_api' && id(input.website_id) && id(input.candidate_id))
    return {
      kind: 'source_api',
      website_id: String(input.website_id),
      candidate_id: String(input.candidate_id),
    };
  throw new Error('Unsupported monitor target.');
}
export class LocalMonitors {
  private items: LocalMonitor[] = [];
  private writes: Promise<unknown> = Promise.resolve();
  private active?: Promise<void>;
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  private creating = false;
  constructor(
    private readonly dir: string,
    private readonly observe: (target: MonitorTarget, fresh: boolean) => Promise<Observation>,
    private readonly now = () => Date.now(),
  ) {}
  list() {
    return structuredClone(this.items);
  }
  private save() {
    const task = this.writes.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const path = join(this.dir, 'monitors.json');
      await writeFile(`${path}.tmp`, JSON.stringify(this.items), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    this.writes = task.catch(() => {});
    return task;
  }
  async load() {
    try {
      this.items = JSON.parse(await readFile(join(this.dir, 'monitors.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      !Array.isArray(this.items) ||
      this.items.some(
        (item) =>
          !item ||
          typeof item.id !== 'string' ||
          ![60, 360, 1440].includes(item.interval_minutes) ||
          !Array.isArray(item.history) ||
          !item.values,
      )
    )
      throw new Error('Saved monitors are invalid; storage was not overwritten.');
    for (const item of this.items) {
      monitorTarget(item.target);
      if (item.phase === 'checking') {
        item.status = 'error';
        item.phase = 'idle';
        item.history.unshift({
          at: new Date(this.now()).toISOString(),
          status: 'error',
          message: 'Interrupted by restart. Previous observations were preserved.',
          changes: [],
        });
      }
      // No catch-up burst: next checks start one interval after this local server starts.
      item.next_at = new Date(this.now() + item.interval_minutes * 60000).toISOString();
    }
    await this.save();
  }
  async create(input: unknown, interval: unknown = 1440) {
    if (this.stopped || this.creating)
      throw new Error('Please wait before creating another check.');
    const target = monitorTarget(input);
    if (![60, 360, 1440].includes(Number(interval)))
      throw new Error('Choose hourly, six-hourly or daily checks.');
    const existing = this.items.find(
      (item) => JSON.stringify(item.target) === JSON.stringify(target),
    );
    if (existing) return structuredClone(existing);
    if (this.items.length >= 10) throw new Error('The local limit is ten scheduled checks.');
    this.creating = true;
    try {
      const observation = await this.observe(target, false);
      const item: LocalMonitor = {
        id: randomUUID(),
        target,
        label: observation.label,
        enabled: true,
        interval_minutes: Number(interval),
        next_at: new Date(this.now() + Number(interval) * 60000).toISOString(),
        phase: 'idle',
        status: 'ready',
        values: observation.values,
        history: [],
      };
      this.items.unshift(item);
      try {
        await this.save();
      } catch (error) {
        this.items = this.items.filter((saved) => saved !== item);
        throw error;
      }
      return structuredClone(item);
    } finally {
      this.creating = false;
    }
  }
  async update(id: string, enabled: boolean) {
    const item = this.items.find((item) => item.id === id);
    if (!item) throw new Error('Scheduled check not found.');
    item.enabled = enabled;
    if (enabled) item.next_at = new Date(this.now() + item.interval_minutes * 60000).toISOString();
    await this.save();
  }
  async remove(id: string) {
    if (this.items.find((item) => item.id === id)?.phase === 'checking')
      throw new Error('Wait for the current check before removing it.');
    this.items = this.items.filter((item) => item.id !== id);
    await this.save();
  }
  async check(id: string) {
    if (this.stopped || this.active)
      throw new Error('A scheduled check is already running or the workspace is stopping.');
    const item = this.items.find((item) => item.id === id);
    if (!item) throw new Error('Scheduled check not found.');
    const task = this.run(item);
    this.active = task;
    try {
      await task;
    } finally {
      this.active = undefined;
    }
  }
  private async run(item: LocalMonitor) {
    item.phase = 'checking';
    try {
      await this.save();
      const observation = await this.observe(item.target, true);
      const changes = [
        ...new Set([...Object.keys(item.values), ...Object.keys(observation.values)]),
      ]
        .filter((key) => item.values[key] !== observation.values[key])
        .map((field) => ({ field, before: item.values[field], after: observation.values[field] }));
      item.values = observation.values;
      item.status = changes.length ? 'changed' : 'unchanged';
      item.history.unshift({
        at: new Date(this.now()).toISOString(),
        status: item.status,
        message: changes.length
          ? `${changes.length} observed fields changed.`
          : 'No observed fields changed.',
        changes: changes.slice(0, 30),
      });
    } catch (error) {
      item.status = 'error';
      item.history.unshift({
        at: new Date(this.now()).toISOString(),
        status: 'error',
        message:
          error instanceof Error
            ? error.message.slice(0, 300)
            : 'Check failed. Previous observations preserved.',
        changes: [],
      });
    } finally {
      item.history = item.history.slice(0, 20);
      item.phase = 'idle';
      item.last_at = new Date(this.now()).toISOString();
      item.next_at = new Date(this.now() + item.interval_minutes * 60000).toISOString();
      await this.save();
    }
  }
  async tick() {
    if (this.stopped || this.active) return;
    const item = this.items
      .filter((item) => item.enabled && Date.parse(item.next_at) <= this.now())
      .sort((a, b) => Date.parse(a.next_at) - Date.parse(b.next_at))[0];
    if (item) await this.check(item.id);
  }
  start() {
    this.timer = setInterval(() => void this.tick().catch(() => {}), 30000);
    this.timer.unref();
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.active;
    await this.writes;
  }
}
