import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResearchRequest } from './requests.js';

export type ResearchJob<T> = {
  id: string;
  request_id: string;
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  started_at: string;
  finished_at?: string;
  result?: T;
  error?: string;
};
export class ResearchJobs<T extends { partial: boolean }> {
  private jobs: ResearchJob<T>[] = [];
  private active = new Map<string, Promise<void>>();
  private writes: Promise<unknown> = Promise.resolve();
  private stopped = false;
  constructor(
    private readonly dir: string,
    private readonly tool: 'shopping' | 'internships',
    private readonly request: (id: string) => ResearchRequest | undefined,
    private readonly run: (request: ResearchRequest, cancelled: () => boolean) => Promise<T>,
  ) {}
  async load() {
    try {
      this.jobs = JSON.parse(await readFile(join(this.dir, `${this.tool}.json`), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      !Array.isArray(this.jobs) ||
      this.jobs.some(
        (job) =>
          !job ||
          typeof job.id !== 'string' ||
          typeof job.request_id !== 'string' ||
          !Number.isFinite(Date.parse(job.started_at)) ||
          !['running', 'completed', 'partial', 'failed', 'cancelled'].includes(job.status),
      )
    )
      throw new Error('Saved research jobs are invalid; storage was not overwritten.');
    for (const job of this.jobs)
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Interrupted by restart. Run fresh to try again.';
        job.finished_at = new Date().toISOString();
      }
    await this.save();
  }
  list() {
    return structuredClone(this.jobs);
  }
  private save() {
    const operation = this.writes.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const path = join(this.dir, `${this.tool}.json`);
      await writeFile(`${path}.tmp`, JSON.stringify(this.jobs), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async start(id: string, fresh: boolean) {
    if (this.stopped) throw new Error('The workspace is shutting down.');
    const request = this.request(id);
    if (!request || request.tool !== this.tool)
      throw new Error('Save a request for this tool first.');
    const running = this.jobs.find((job) => job.request_id === id && job.status === 'running');
    if (running) return { job: structuredClone(running), cached: false };
    const cached = this.jobs.find(
      (job) =>
        job.request_id === id &&
        ['completed', 'partial'].includes(job.status) &&
        Date.now() - Date.parse(job.finished_at!) < 15 * 60000,
    );
    if (!fresh && cached) return { job: structuredClone(cached), cached: true };
    if (
      this.jobs.filter((job) => Date.now() - Date.parse(job.started_at) < 24 * 60 * 60000).length >=
      30
    )
      throw new Error(
        'Daily run limit reached: 30 checks per tool in a rolling 24 hours. Cached results remain available.',
      );
    if (this.active.size >= 2 || this.jobs.filter((job) => job.status === 'running').length >= 2)
      throw new Error('Two checks are already active. Please wait.');
    const job: ResearchJob<T> = {
      id: randomUUID(),
      request_id: id,
      status: 'running',
      started_at: new Date().toISOString(),
    };
    this.jobs.unshift(job);
    this.jobs = this.jobs.filter((item, index) => index < 200 || item.status === 'running');
    try {
      await this.save();
    } catch (error) {
      this.jobs = this.jobs.filter((item) => item !== job);
      throw error;
    }
    const task = this.execute(job, request);
    this.active.set(job.id, task);
    void task.finally(() => this.active.delete(job.id)).catch(() => {});
    return { job: structuredClone(job), cached: false };
  }
  private async execute(job: ResearchJob<T>, request: ResearchRequest) {
    const timer = setTimeout(() => {
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Check timed out. Run fresh to retry.';
        job.finished_at = new Date().toISOString();
        void this.save().catch(() => {});
      }
    }, 60000);
    try {
      if (job.status !== 'running') return;
      const result = await this.run(request, () => job.status !== 'running');
      if (job.status === 'running') {
        job.result = result;
        job.status = result.partial ? 'partial' : 'completed';
      }
    } catch {
      if (job.status === 'running') {
        job.status = 'failed';
        job.error =
          'Check could not finish. Check TinyFish configuration or try another public URL.';
      }
    } finally {
      clearTimeout(timer);
      job.finished_at ??= new Date().toISOString();
      await this.save();
    }
  }
  async cancel(id: string) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('Check not found.');
    if (job.status === 'running') {
      job.status = 'cancelled';
      job.finished_at = new Date().toISOString();
      await this.save();
    }
    return structuredClone(job);
  }
  async close() {
    this.stopped = true;
    for (const job of this.jobs) if (job.status === 'running') await this.cancel(job.id);
    await Promise.allSettled(this.active.values());
    await this.writes;
  }
  async finished(id: string) {
    await this.active.get(id);
    return this.list().find((job) => job.id === id);
  }
}
