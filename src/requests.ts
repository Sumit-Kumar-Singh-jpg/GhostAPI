import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicUrl, publicAddress } from './websites/public-read.js';
import { isIP } from 'node:net';

export type ResearchRequest = {
  id: string;
  tool: 'shopping' | 'internships';
  intent: 'find_product' | 'check_listing' | 'check_internship';
  input: string;
  created_at: string;
  status: 'not_checked';
  company_url?: string;
};

export function validateRequest(
  body: unknown,
): Omit<ResearchRequest, 'id' | 'created_at' | 'status'> {
  if (!body || typeof body !== 'object') throw new Error('Enter a request.');
  const { tool, intent, input } = body as Record<string, unknown>;
  if (!(
    (tool === 'shopping' && ['find_product', 'check_listing'].includes(String(intent))) ||
    (tool === 'internships' && intent === 'check_internship')
  ))
    throw new Error('Choose a supported tool and task.');
  if (typeof input !== 'string' || input.trim().length < 3 || input.length > 5000)
    throw new Error('Enter between 3 and 5,000 characters.');
  let value = input.trim();
  if (tool === 'shopping' && intent === 'find_product' && value.length > 500)
    throw new Error('Keep product searches under 500 characters.');
  if (intent === 'check_listing' || /^https?:\/\/\S+$/i.test(value)) {
    const url = publicUrl(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname) && !publicAddress(hostname)) throw new Error('Use a public website URL.');
    value = url.href;
  }
  const company = (body as Record<string, unknown>).company_url;
  let company_url: string | undefined;
  if (tool === 'internships' && company !== undefined && company !== '') {
    if (typeof company !== 'string') throw new Error('Use a public company website URL.');
    const url = publicUrl(company.trim());
    const companyHost = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(companyHost) && !publicAddress(companyHost))
      throw new Error('Use a public company website.');
    company_url = url.href;
  }
  return {
    tool,
    intent: intent as ResearchRequest['intent'],
    input: value,
    ...(company_url ? { company_url } : {}),
  };
}

// Intake only: saving a request never starts a provider run or issues a verdict.
export class ResearchRequests {
  private items: ResearchRequest[] = [];
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string) {}
  async load() {
    try {
      this.items = JSON.parse(await readFile(join(this.dir, 'requests.json'), 'utf8'));
      if (!Array.isArray(this.items)) throw new Error('Invalid saved requests.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  list() {
    return structuredClone(this.items);
  }
  async create(body: unknown): Promise<ResearchRequest> {
    const input = validateRequest(body);
    const operation = this.writes.then(async () => {
      const existing = this.items.find(
        (item) =>
          item.tool === input.tool &&
          item.intent === input.intent &&
          item.input === input.input &&
          item.company_url === input.company_url,
      );
      if (existing) return structuredClone(existing);
      if (this.items.length >= 500)
        throw new Error('The local request limit of 500 has been reached.');
      const item: ResearchRequest = {
        ...input,
        id: randomUUID(),
        created_at: new Date().toISOString(),
        status: 'not_checked',
      };
      const next = [item, ...this.items];
      await mkdir(this.dir, { recursive: true });
      const path = join(this.dir, 'requests.json');
      await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2), 'utf8');
      await rename(`${path}.tmp`, path);
      this.items = next;
      return structuredClone(item);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
}
