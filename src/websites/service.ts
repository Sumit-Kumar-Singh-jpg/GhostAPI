import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extract, inspectPage, type Field, type Inspection } from './inspect.js';
import { publicUrl, readPublicPage, type PublicPage } from './public-read.js';
import type { Discovery } from './discovery.js';
import { buildVisual, CAPTURE_VERSION, type Visual } from './visual.js';
import { inspectCloneCapture } from './rea.js';
import { CAPTURE_VIEWPORT, screenshotPreview, type RenderedPage } from './render.js';

type Contract = { version: number; origin: string; fields: Field[]; approved_at: string };
type Result = {
  at: string;
  source: string;
  contract_version: number;
  data: Record<string, string>;
};
type History = {
  at: string;
  status: string;
  detail: string;
  changes?: { field: string; before?: string; after: string }[];
};
export type Website = {
  id: string;
  name: string;
  url: string;
  task: string;
  created_at: string;
  archived_at?: string;
  status: 'draft' | 'ready' | 'healthy' | 'changed' | 'broken' | 'error';
  phase: 'idle' | 'inspecting' | 'checking';
  monitoring: boolean;
  interval_minutes: number;
  next_check?: string;
  last_checked?: string;
  error?: string;
  inspection?: Inspection;
  discovery?: Discovery;
  discovery_error?: string;
  contract?: Contract;
  versions: Contract[];
  result?: Result;
  history: History[];
  repair?: { based_on: number; fields: Field[]; changed: string[]; discovered_at: string };
};

export class Websites {
  private visuals = new Map<string, Visual>();
  private visualJobs = new Map<string, Promise<Visual>>();
  private visualQueue: Promise<unknown> = Promise.resolve();
  private sites: Website[] = [];
  private pending = Promise.resolve();
  private writes = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(
    private readonly dir: string,
    private readonly reader: (url: string) => Promise<PublicPage> = readPublicPage,
    private readonly discover?: (page: PublicPage) => Promise<Discovery>,
    private readonly renderer?: (url: string) => Promise<RenderedPage>,
  ) {}
  async load() {
    await mkdir(this.dir, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(join(this.dir, 'websites.json'), 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.sites))
        throw new Error('Website storage is incompatible.');
      this.sites = saved.sites;
      for (const site of this.sites) {
        if (site.phase !== 'idle') {
          site.phase = 'idle';
          site.status = 'error';
          site.error = 'The previous check was interrupted. Run a fresh check.';
        }
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await this.save();
  }
  snapshot() {
    return structuredClone(this.sites.filter((site) => !site.archived_at));
  }
  private get(id: unknown) {
    const site = this.sites.find((s) => s.id === id && !s.archived_at);
    if (!site) throw new Error('Website not found.');
    return site;
  }
  private save() {
    const data = JSON.stringify({ version: 1, sites: this.sites }, null, 2);
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        const temp = join(this.dir, `websites-${randomUUID()}.tmp`);
        await writeFile(temp, data, { mode: 0o600 });
        await rename(temp, join(this.dir, 'websites.json'));
      });
    this.writes = write;
    return write;
  }
  private record(site: Website, status: string, detail: string, changes?: History['changes']) {
    site.history.unshift({
      at: new Date().toISOString(),
      status,
      detail,
      ...(changes ? { changes } : {}),
    });
    site.history = site.history.slice(0, 40);
  }
  private async enqueue(site: Website, phase: Website['phase'], job: () => Promise<void>) {
    if (this.stopped || site.phase !== 'idle')
      throw new Error('This website already has a check in progress.');
    site.phase = phase;
    delete site.error;
    await this.save();
    this.pending = this.pending
      .then(async () => {
        try {
          await job();
        } catch (error) {
          site.status = 'error';
          site.error =
            error instanceof Error ? error.message.slice(0, 350) : 'Website check failed.';
          this.record(site, 'error', site.error);
        } finally {
          site.phase = 'idle';
          if (site.monitoring)
            site.next_check = new Date(Date.now() + site.interval_minutes * 60000).toISOString();
          else delete site.next_check;
          await this.save();
        }
      })
      .catch((error) => {
        console.error(
          'Website job could not be persisted:',
          error instanceof Error ? error.name : 'Error',
        );
      });
  }
  async inspect(input: Record<string, unknown>) {
    if (this.sites.filter((site) => !site.archived_at).length >= 10)
      throw new Error(
        'This workspace supports up to 10 websites. Archive an existing website first.',
      );
    const url = publicUrl(String(input.url ?? '')).href;
    const name =
      String(input.name ?? '')
        .trim()
        .slice(0, 100) || new URL(url).hostname;
    const task = String(input.task ?? '')
      .trim()
      .slice(0, 500);
    const site: Website = {
      id: randomUUID(),
      name,
      task,
      url,
      created_at: new Date().toISOString(),
      status: 'draft',
      phase: 'idle',
      monitoring: false,
      interval_minutes: 60,
      versions: [],
      history: [],
    };
    this.sites.unshift(site);
    await this.enqueue(site, 'inspecting', async () => {
      const page = await this.reader(site.url);
      site.inspection = inspectPage(page);
      if (this.discover) {
        try {
          site.discovery = await this.discover(page);
        } catch {
          site.discovery_error =
            'TinyFish discovery unavailable. Source fields below remain available; retry by analyzing the URL again.';
        }
      }
      site.status = site.inspection.fields.length ? 'ready' : 'error';
      if (!site.inspection.fields.length)
        site.error =
          'No unambiguous fields were found. Try a specific detail page or a public JSON URL. JavaScript-only pages are not supported yet.';
      this.record(
        site,
        site.status,
        `${site.inspection.fields.length} candidate fields discovered from public response data.`,
      );
    });
    return site.id;
  }
  async approve(id: unknown, input: Record<string, unknown>) {
    const site = this.get(id);
    if (
      site.phase !== 'idle' ||
      !site.inspection ||
      input.inspection_hash !== site.inspection.sha256
    )
      throw new Error('Inspection changed. Review the current fields before approving.');
    const keys = input.fields;
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      keys.length > 20 ||
      new Set(keys).size !== keys.length
    )
      throw new Error('Select at least one distinct discovered field.');
    const fields = keys.map((key) => site.inspection!.fields.find((field) => field.key === key));
    if (fields.some((field) => !field))
      throw new Error('Only fields from this inspection can be approved.');
    const minutes = Number(input.interval_minutes);
    if (![15, 60, 360, 1440].includes(minutes))
      throw new Error('Choose a supported monitoring interval.');
    site.contract = {
      version: (site.contract?.version ?? 0) + 1,
      origin: new URL(site.inspection.url).origin,
      fields: fields as Field[],
      approved_at: new Date().toISOString(),
    };
    site.versions.push(structuredClone(site.contract));
    site.versions = site.versions.slice(-20);
    site.interval_minutes = minutes;
    site.monitoring = true;
    delete site.result;
    delete site.repair;
    this.record(
      site,
      'approved',
      `Contract v${site.contract.version} approved with ${fields.length} required fields.`,
    );
    await this.check(site.id);
  }
  async check(id: unknown) {
    const site = this.get(id);
    if (!site.contract) throw new Error('Approve an extraction contract before monitoring.');
    await this.enqueue(site, 'checking', async () =>
      this.checkPage(site, await this.reader(site.url)),
    );
  }
  private checkPage(site: Website, page: PublicPage) {
    const contract = site.contract!;
    site.last_checked = new Date().toISOString();
    const { data, missing } = extract(page, contract.fields, contract.origin);
    if (missing.length) {
      site.status = 'broken';
      site.error = `Required fields could not be extracted: ${missing.join(', ')}.`;
      delete site.repair;
      const inspection = inspectPage(page);
      site.inspection = inspection;
      const replacements = contract.fields.map((field) =>
        missing.includes(field.key) ? inspection.fields.find((f) => f.key === field.key) : field,
      );
      if (replacements.every(Boolean)) {
        const fields = replacements as Field[];
        if (!extract(page, fields, contract.origin).missing.length)
          site.repair = {
            based_on: contract.version,
            fields,
            changed: missing,
            discovered_at: site.last_checked,
          };
      }
      this.record(
        site,
        'broken',
        site.repair
          ? `${site.error} A replacement extraction rule is available for review.`
          : site.error,
      );
      return;
    }
    const changes = Object.entries(data)
      .filter(([key, value]) => site.result && site.result.data[key] !== value)
      .map(([field, after]) => ({ field, before: site.result?.data[field], after }));
    site.status = changes.length ? 'changed' : 'healthy';
    delete site.error;
    delete site.repair;
    site.result = {
      at: site.last_checked,
      source: page.url,
      contract_version: contract.version,
      data,
    };
    this.record(
      site,
      site.status,
      changes.length
        ? `${changes.length} monitored values changed. Extraction still passes.`
        : 'Approved source and all required fields passed.',
      changes,
    );
  }
  async applyRepair(id: unknown, version: unknown) {
    const site = this.get(id),
      proposal = site.repair;
    if (!proposal || proposal.based_on !== site.contract?.version || version !== proposal.based_on)
      throw new Error('Repair proposal is stale. Run a fresh check.');
    await this.enqueue(site, 'checking', async () => {
      const page = await this.reader(site.url);
      if (extract(page, proposal.fields, site.contract!.origin).missing.length)
        throw new Error('Repair failed fresh verification. Active contract was preserved.');
      const next: Contract = {
        ...site.contract!,
        version: site.contract!.version + 1,
        fields: proposal.fields,
        approved_at: new Date().toISOString(),
      };
      site.contract = next;
      site.versions.push(structuredClone(next));
      site.versions = site.versions.slice(-20);
      this.record(
        site,
        'repaired',
        `Contract v${next.version} applied after a fresh source read and required-field verification.`,
      );
      this.checkPage(site, page);
    });
  }
  async toggle(id: unknown, enabled: boolean) {
    const site = this.get(id);
    if (site.phase !== 'idle') throw new Error('Wait for the current check to finish.');
    if (enabled && !site.contract) throw new Error('Approve a contract first.');
    site.monitoring = enabled;
    if (enabled) site.next_check = new Date().toISOString();
    else delete site.next_check;
    this.record(
      site,
      enabled ? 'resumed' : 'paused',
      enabled ? 'Monitoring resumed.' : 'Scheduled monitoring paused.',
    );
    await this.save();
  }
  async archive(id: unknown) {
    const site = this.get(id);
    if (site.phase !== 'idle') throw new Error('Wait for the current check to finish.');
    site.monitoring = false;
    delete site.next_check;
    site.archived_at = new Date().toISOString();
    this.record(
      site,
      'archived',
      'Website removed from the active workspace. History retained in storage.',
    );
    await this.save();
  }
  data(id: unknown) {
    const site = this.get(id);
    if (
      !site.result ||
      !['healthy', 'changed'].includes(site.status) ||
      site.result.contract_version !== site.contract?.version
    )
      throw new Error(
        'Current extraction is unavailable. Review the website status; previous data is withheld.',
      );
    return {
      website_id: site.id,
      status: site.status,
      ...site.result,
      monitoring: site.monitoring,
      next_check: site.next_check ?? null,
      validation:
        'Approved origin and required field presence; values are supplied by the source website.',
    };
  }
  async visual(id: string, rebuild = false) {
    if (this.stopped) throw new Error('The workspace is shutting down.');
    const existing = this.visualJobs.get(id);
    if (existing) return existing;
    const job = this.visualQueue.then(() => this.buildVisualCapture(id, rebuild));
    this.visualJobs.set(id, job);
    this.visualQueue = job.catch(() => {});
    try {
      return await job;
    } finally {
      this.visualJobs.delete(id);
    }
  }
  private async buildVisualCapture(id: string, rebuild = false) {
    const site = this.get(id);
    if (!site.inspection) throw new Error('Wait for website inspection to finish.');
    if (!rebuild) {
      try {
        const saved =
          this.visuals.get(id) ??
          (JSON.parse(await readFile(join(this.dir, `visual-${site.id}.json`), 'utf8')) as Visual);
        if (saved.capture_version === CAPTURE_VERSION) {
          this.visuals.set(id, saved);
          return saved;
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    let rendered: RenderedPage | undefined;
    if (this.renderer) {
      try {
        rendered = await this.renderer(site.url);
      } catch {
        /* Keep the public HTML fallback available. */
      }
    }
    const visual = await buildVisual(
      rendered?.page ?? (await this.reader(site.url)),
      site.contract?.fields ?? site.inspection.fields,
      site.id,
      rendered
        ? async (url) => {
            const asset = rendered.assets.get(url);
            // Freeze the same response bytes used by the capture browser; do not refetch changed assets.
            if (!asset) throw new Error('Asset was not loaded during browser capture.');
            return asset;
          }
        : undefined,
    );
    if (rendered) {
      visual.controls = rendered.controls ?? [];
      // The generated DOM is not an HTTP response. Only original reads enter REA evidence.
      visual.captured_requests = rendered.requests;
      visual.notes.push(...rendered.warnings);
      visual.rendered = {
        mode: 'browser',
        viewport: CAPTURE_VIEWPORT,
        captured_at: new Date().toISOString(),
        source_screenshot: rendered.screenshot,
      };
      try {
        visual.rendered.preview_screenshot = await screenshotPreview(visual.html);
      } catch {
        visual.notes.push('Preview comparison screenshot could not be captured.');
      }
      if (rendered.warnings.some((warning) => !warning.startsWith('Captured at')))
        visual.quality.status = 'incomplete';
    } else if (this.renderer) {
      visual.rendered = {
        mode: 'static-fallback',
        viewport: CAPTURE_VIEWPORT,
        captured_at: new Date().toISOString(),
      };
      visual.quality.status = 'incomplete';
      visual.notes.push(
        'Browser capture failed or exceeded its limits. Showing the raw HTML fallback; JavaScript-rendered content may be missing. Rebuild to retry.',
      );
    }
    try {
      visual.rea = await inspectCloneCapture(visual.captured_requests, this.dir);
      const source = visual.rea.requests.find(
        (request) =>
          request.url === visual.captured_requests[0]?.url &&
          ['document', 'json'].includes(request.kind),
      );
      if (source && visual.rea.evidence_id)
        for (const binding of visual.bindings) {
          binding.rea_source = { evidence_id: visual.rea.evidence_id, url: source.url };
        }
    } catch {
      visual.rea = {
        status: 'unavailable',
        requests: [],
        limitations: [
          'REA inspection failed or timed out. This capture has no verified REA evidence. Rebuild to retry.',
        ],
      };
    }
    const visualPath = join(this.dir, `visual-${site.id}.json`);
    await writeFile(`${visualPath}.tmp`, JSON.stringify(visual), {
      mode: 0o600,
    });
    await rename(`${visualPath}.tmp`, visualPath);
    this.visuals.set(id, visual);
    return visual;
  }
  preview(id: string) {
    this.get(id);
    const visual = this.visuals.get(id);
    if (!visual) throw new Error('Build the visual preview first.');
    return visual.html;
  }
  async interactionSource(id: string) {
    const site = this.get(id);
    let visual = this.visuals.get(id);
    if (!visual) {
      try {
        visual = JSON.parse(
          await readFile(join(this.dir, `visual-${site.id}.json`), 'utf8'),
        ) as Visual;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return {
      url: site.url,
      controls: visual?.capture_version === CAPTURE_VERSION ? (visual.controls ?? []) : [],
    };
  }
  field(id: string, key: string) {
    const result = this.data(id);
    if (!Object.hasOwn(result.data, key))
      throw new Error('This field is not in the approved contract.');
    return {
      source: result.source,
      at: result.at,
      contract_version: result.contract_version,
      field: key,
      value: result.data[key],
      kind: 'generated_extraction',
    };
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 30000);
    this.timer.unref();
  }
  async tick(now = Date.now()) {
    if (this.stopped) return;
    const next = this.sites.find(
      (site) =>
        site.monitoring &&
        site.phase === 'idle' &&
        (!site.next_check || Date.parse(site.next_check) <= now),
    );
    if (next) await this.check(next.id).catch(() => undefined);
  }
  async idle() {
    await this.pending;
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.pending;
    await this.writes;
    await this.visualQueue;
  }
}
