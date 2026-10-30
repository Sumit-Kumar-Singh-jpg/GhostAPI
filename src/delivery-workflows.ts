import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeliveryJobs } from './delivery-jobs.js';
import type { DeliveryInput } from './delivery.js';

type Contract = {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'retired';
  created_at: string;
  published_at?: string;
  source_job_id: string;
  source_run_id: string;
  replaces_id?: string;
  validation_job_ids?: string[];
  validation_cases?: DeliveryInput[];
  spec: {
    url: string;
    replaces?: { id: string; digest: string };
    engine: 'amazon-delivery-v1';
    allowed_domains: string[];
    actions: string[];
    inputs: Record<string, unknown>;
    result_schema: Record<string, unknown>;
    baseline: {
      observed_pin?: string;
      observed_variant?: string;
      excerpt?: string;
      checked_at: string;
    };
    evidence: string[];
    limitations: string[];
  };
  digest: string;
};
const digest = (spec: Contract['spec']) =>
  createHash('sha256').update(JSON.stringify(spec)).digest('hex');
export class DeliveryWorkflows {
  private pending = new Set<string>();
  private items: Contract[] = [];
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private dir: string,
    private jobs: DeliveryJobs,
  ) {}
  async load() {
    try {
      this.items = JSON.parse(await readFile(join(this.dir, 'delivery-workflows.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      !Array.isArray(this.items) ||
      this.items.some(
        (item) =>
          !item ||
          !['draft', 'published', 'retired'].includes(item.status) ||
          item.spec?.engine !== 'amazon-delivery-v1' ||
          digest(item.spec) !== item.digest,
      )
    )
      throw new Error('Invalid delivery workflow storage; not overwritten.');
  }
  list() {
    return structuredClone(this.items).map((item) => {
      const recent = this.jobs
        .list()
        .filter((job) => job.contract?.id === item.id)
        .slice(0, 3);
      const latest = recent[0];
      const health = !latest
        ? 'not_checked'
        : latest.status === 'failed'
          ? latest.error_code === 'request_rejected'
            ? 'provider_rejected'
            : latest.error_code === 'timed_out'
              ? 'timed_out'
              : 'execution_failed'
          : latest.status === 'completed' &&
              latest.result?.observation.reason_code === 'access_blocked'
            ? 'access_blocked'
            : latest.status === 'completed' && latest.result?.verdict === 'UNKNOWN'
              ? recent.length >= 2 &&
                recent
                  .slice(0, 2)
                  .every(
                    (job) =>
                      job.status === 'completed' &&
                      job.result?.verdict === 'UNKNOWN' &&
                      job.result.observation.reason_code !== 'access_blocked',
                  )
                ? 'suspected_drift'
                : 'needs_verification'
              : latest.status === 'completed'
                ? 'observed'
                : latest.status;
      return { ...item, health };
    });
  }
  private save() {
    const snapshot = JSON.stringify(this.items);
    const task = this.writes.then(async () => {
      await mkdir(this.dir, { recursive: true });
      const file = join(this.dir, 'delivery-workflows.json');
      await writeFile(file + '.tmp', snapshot, { mode: 0o600 });
      await rename(file + '.tmp', file);
    });
    this.writes = task.catch(() => {});
    return task;
  }
  async discover(jobId: string) {
    const job = this.jobs.list().find((item) => item.id === jobId);
    if (
      !job ||
      job.status !== 'completed' ||
      !job.run_id ||
      !job.result ||
      job.result.verdict === 'UNKNOWN'
    )
      throw new Error('Select a completed delivery check with confirmed PIN and variant evidence.');
    const existing = this.items.find(
      (item) => item.source_job_id === jobId && item.status === 'draft',
    );
    if (existing) return structuredClone(existing);
    const spec: Contract['spec'] = {
      url: job.input.url,
      engine: 'amazon-delivery-v1',
      allowed_domains: ['amazon.in', 'www.amazon.in'],
      actions: [
        'Open this product listing',
        'Read or select the requested laptop variant',
        'Open delivery location, enter and apply the PIN',
        'Confirm displayed PIN and actual configuration',
        'Read delivery message and return structured observations',
      ],
      inputs: {
        type: 'object',
        properties: {
          pincode: { type: 'string', pattern: '^[1-9][0-9]{5}$' },
          variant: { type: 'string', minLength: 1, maxLength: 200 },
        },
        required: ['pincode'],
        additionalProperties: false,
      },
      result_schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string', enum: ['DELIVERABLE', 'NOT_DELIVERABLE', 'UNKNOWN'] },
          contradiction: { type: ['boolean', 'null'] },
          observation: { type: 'object' },
          checked_at: { type: 'string', format: 'date-time' },
          source_url: { type: 'string', format: 'uri' },
          workflow_version: { type: 'string' },
          reason: { type: 'string' },
        },
        required: [
          'verdict',
          'contradiction',
          'observation',
          'checked_at',
          'source_url',
          'workflow_version',
          'reason',
        ],
      },
      baseline: {
        observed_pin: job.result.observation.observed_pin,
        observed_variant: job.result.observation.observed_variant,
        excerpt: job.result.observation.excerpt,
        checked_at: job.result.checked_at,
      },
      evidence: [
        'Confirmed requested PIN',
        'Actual selected variant',
        'Exact delivery message',
        'Source URL and observation time',
        'TinyFish run ID',
      ],
      limitations: [
        'Supported Amazon India product page only',
        'Uses the supported delivery engine; not an automatically inferred arbitrary workflow',
        'Agent-reported observations; no independent certification',
        'No login, checkout, cart or payments',
        'Fresh provider run per invocation; local deadline does not guarantee remote cancellation',
      ],
    };
    const item: Contract = {
      id: randomUUID(),
      version:
        1 +
        Math.max(
          0,
          ...this.items.filter((item) => item.spec.url === spec.url).map((item) => item.version),
        ),
      status: 'draft',
      created_at: new Date().toISOString(),
      source_job_id: job.id,
      source_run_id: job.run_id,
      spec,
      digest: digest(spec),
    };
    this.items.unshift(item);
    this.pending.add(item.id);
    try {
      await this.save();
    } catch (error) {
      this.items = this.items.filter((candidate) => candidate.id !== item.id);
      throw error;
    } finally {
      this.pending.delete(item.id);
    }
    return structuredClone(item);
  }
  async publish(id: string, expected: string) {
    const item = this.items.find((item) => item.id === id);
    if (
      !item ||
      item.status !== 'draft' ||
      this.pending.has(id) ||
      item.digest !== expected ||
      digest(item.spec) !== expected
    )
      throw new Error('Review the current draft and its digest before publishing.');
    const parent = item.replaces_id
      ? this.items.find((parent) => parent.id === item.replaces_id)
      : undefined;
    if (item.replaces_id) {
      if (
        !parent ||
        parent.status !== 'published' ||
        item.spec.replaces?.id !== parent.id ||
        item.spec.replaces.digest !== parent.digest
      )
        throw new Error('The version being replaced is no longer published.');
      const validations = (item.validation_job_ids ?? []).map((id) =>
        this.jobs.list().find((job) => job.id === id),
      );
      if (
        !validations.length ||
        validations.length !== item.validation_cases?.length ||
        validations.some(
          (job, index) =>
            !job ||
            JSON.stringify(job.input) !== JSON.stringify(item.validation_cases?.[index]) ||
            job.status !== 'completed' ||
            !job.result ||
            job.result.verdict === 'UNKNOWN' ||
            job.contract?.digest !== item.digest ||
            Date.parse(job.started_at) < Date.now() - 15 * 60000,
        )
      )
        throw new Error(
          'Validate this replacement with fresh confirmed evidence before publishing.',
        );
    }
    item.status = 'published';
    if (parent) parent.status = 'retired';
    this.pending.add(id);
    item.published_at = new Date().toISOString();
    try {
      await this.save();
    } catch (error) {
      item.status = 'draft';
      if (parent) parent.status = 'published';
      delete item.published_at;
      throw error;
    } finally {
      this.pending.delete(id);
    }
    return structuredClone(item);
  }
  async retire(id: string) {
    const item = this.items.find((item) => item.id === id);
    if (!item || this.pending.has(id)) throw new Error('Workflow not found or updating.');
    const previous = item.status;
    item.status = 'retired';
    this.pending.add(id);
    try {
      await this.save();
    } catch (error) {
      item.status = previous;
      throw error;
    } finally {
      this.pending.delete(id);
    }
  }
  async proposeReplacement(parentId: string, jobId: string) {
    const parent = this.items.find((item) => item.id === parentId && item.status === 'published');
    const job = this.jobs.list().find((job) => job.id === jobId);
    if (
      !parent ||
      !job ||
      job.input.url !== parent.spec.url ||
      jobId === parent.source_job_id ||
      Date.parse(job.result?.checked_at ?? '') < Date.parse(parent.created_at)
    )
      throw new Error('Select a newer confirmed check for the same product URL.');
    const draft = await this.discover(jobId);
    const saved = this.items.find((item) => item.id === draft.id)!;
    if (this.pending.has(saved.id)) throw new Error('Draft is updating.');
    if (saved.replaces_id && saved.replaces_id !== parentId)
      throw new Error('Draft already replaces another version.');
    saved.replaces_id = parentId;
    saved.spec.replaces = { id: parent.id, digest: parent.digest };
    saved.digest = digest(saved.spec);
    await this.save();
    return structuredClone(saved);
  }
  async validateReplacement(id: string) {
    const item = this.items.find((item) => item.id === id);
    if (!item || item.status !== 'draft' || !item.replaces_id || this.pending.has(id))
      throw new Error('Select a replacement draft before validation.');
    const parent = this.items.find(
      (parent) => parent.id === item.replaces_id && parent.status === 'published',
    );
    if (!parent) throw new Error('Original version is no longer published.');
    const candidates = this.jobs
      .list()
      .filter(
        (job) =>
          (job.id === parent.source_job_id ||
            job.id === item.source_job_id ||
            job.contract?.id === parent.id) &&
          job.status === 'completed' &&
          !!job.result &&
          job.result?.verdict !== 'UNKNOWN',
      );
    const cases = [
      ...new Map(
        [
          ...candidates.filter((job) => job.id === item.source_job_id),
          ...candidates.filter((job) => job.id === parent.source_job_id),
          ...candidates,
        ].map((job) => [JSON.stringify(job.input), job.input]),
      ).values(),
    ].slice(0, 3);
    if (!cases.length) throw new Error('No supported regression inputs are available.');
    this.pending.add(id);
    item.validation_job_ids = [];
    item.validation_cases = cases;
    try {
      await this.save();
      for (const input of cases) {
        const job = await this.jobs.start(input, {
          id: item.id,
          version: item.version,
          digest: item.digest,
        });
        item.validation_job_ids.push(job.id);
        await this.save();
        await this.jobs.finished(job.id);
      }
      await this.save();
    } finally {
      this.pending.delete(id);
    }
    return structuredClone(item);
  }
  async invoke(id: string, raw: unknown) {
    const item = this.items.find((item) => item.id === id);
    if (
      !item ||
      this.pending.has(id) ||
      item.status !== 'published' ||
      digest(item.spec) !== item.digest
    )
      throw new Error('Publish a reviewed workflow before invoking it.');
    if (
      !raw ||
      typeof raw !== 'object' ||
      Object.keys(raw).some((key) => !['pincode', 'variant'].includes(key))
    )
      throw new Error('Provide PIN and optional variant only; the reviewed URL is fixed.');
    return this.jobs.start(
      { url: item.spec.url, ...raw },
      { id: item.id, version: item.version, digest: item.digest },
    );
  }
  documentation(id: string, production = false) {
    const item = this.items.find((item) => item.id === id);
    if (!item) throw new Error('Workflow not found.');
    return {
      openapi: '3.1.0',
      info: { title: 'GhostAPI delivery workflow', version: String(item.version) },
      paths: {
        [`/api/delivery-workflows/${id}/invoke`]: {
          post: {
            summary: 'Start a fresh delivery observation on the reviewed product URL',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: item.spec.inputs } },
            },
            responses: {
              202: {
                description: 'Job accepted; poll returned status_url',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { job_id: { type: 'string' }, status_url: { type: 'string' } },
                      required: ['job_id', 'status_url'],
                    },
                  },
                },
              },
              400: { description: 'Invalid inputs or unpublished workflow' },
              429: { description: 'Shared delivery quota or concurrency limit reached' },
            },
            security: [{ sessionCookie: [] }],
          },
        },
        '/api/delivery-jobs/{job_id}': {
          get: {
            summary: 'Poll a delivery job; terminal failures may have no result',
            parameters: [
              { name: 'job_id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            security: [{ sessionCookie: [] }],
            responses: {
              200: {
                description: 'Job status, run identity, optional result and contract provenance',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        status: {
                          type: 'string',
                          enum: [
                            'queued',
                            'running',
                            'completed',
                            'failed',
                            'cancelled',
                            'interrupted',
                          ],
                        },
                        result: item.spec.result_schema,
                        contract: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            version: { type: 'integer' },
                            digest: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
              404: { description: 'Job not found' },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: production ? '__Host-ghostapi_session' : 'ghostapi_session',
          },
        },
      },
      'x-ghostapi': {
        status: item.status,
        digest: item.digest,
        required_header: { 'X-GhostAPI-Client': 'dashboard' },
        example: { pincode: '560064' },
        poll: '/api/delivery-jobs/{job_id}',
        limitations: item.spec.limitations,
      },
    };
  }
  async close() {
    await this.writes;
  }
}
