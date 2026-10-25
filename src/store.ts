import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { baseline } from './domain/policy.js';
import type { State, TimelineEvent } from './domain/types.js';

export class Store {
  state: State;
  private writes = Promise.resolve();
  constructor(
    readonly dir: string,
    origin: string,
  ) {
    this.state = {
      revision: 1,
      release: 'r1',
      health: 'NotEnrolled',
      active_version: 1,
      activation_history: [1],
      generation: 0,
      workflows: [baseline(origin)],
      runs: [],
      events: [],
      candidates: [],
      evidence: [],
      outstanding: [],
    };
  }
  async load() {
    await mkdir(this.dir, { recursive: true });
    try {
      const parsed: State = JSON.parse(await readFile(join(this.dir, 'state.json'), 'utf8'));
      if (
        parsed.revision !== 1 ||
        !Array.isArray(parsed.workflows) ||
        !Array.isArray(parsed.runs) ||
        parsed.workflows[0]?.allowed_origin !== this.state.workflows[0]?.allowed_origin
      )
        throw new Error('Saved state is incompatible; preserve it and choose a new DATA_DIR.');
      this.state = parsed;
      // A crashed process never resumes an in-flight candidate or publishes its result.
      if (this.state.cycle?.status === 'active') {
        this.state.cycle.status = 'expired';
        this.state.health = 'Degraded';
        delete this.state.published;
        // A crash between pointer write and final replay must not turn a
        // provisional candidate into a previously verified active version.
        const committed = this.state.activation_history.at(-1);
        if (committed !== undefined && committed !== this.state.active_version) {
          this.state.active_version = committed;
          this.state.generation++;
        }
        for (const candidate of this.state.candidates)
          if (candidate.state === 'Verifying' || candidate.state === 'Draft')
            candidate.state = 'Quarantined';
      }
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
    }
    await this.save();
  }
  event(kind: TimelineEvent['kind'], title: string, detail: string, ref?: string) {
    this.state.events.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      kind,
      title,
      detail,
      ...(ref ? { ref } : {}),
    });
  }
  save() {
    const text = JSON.stringify(this.state, null, 2);
    this.writes = this.writes.then(async () => {
      const temp = join(this.dir, `state-${randomUUID()}.tmp`);
      await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, join(this.dir, 'state.json'));
    });
    return this.writes;
  }
}
