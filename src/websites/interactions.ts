import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureRenderedPage, type ReadControl, type RenderedPage } from './render.js';
import { captureRequest, inspectCloneCapture, type CloneEvidence } from './rea.js';
import { publicUrl, readPublicPage, type PublicPage } from './public-read.js';

type FieldMatch = { path: string[]; value: string; type: 'string' | 'number' };
export type SourceCandidate = {
  id: string;
  url: string;
  method: 'GET';
  status: 'verified' | 'unverified' | 'stale';
  fields: FieldMatch[];
  reason: string;
  verified_at?: string;
};
export type InteractionReport = {
  id: string;
  website_id: string;
  control: ReadControl;
  captured_at: string;
  candidates: SourceCandidate[];
  evidence?: CloneEvidence;
  limitations: string[];
};
const sensitive =
  /password|token|secret|credential|authorization|cookie|session|email|phone|address|api.?key/i;
const queryKeys = /^(?:page|offset|limit|q|query|search|sort|order|category|id|product|per_page)$/i;
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();

export function replayUrl(value: string, origin: string): string {
  const url = publicUrl(value);
  if (
    url.origin !== origin ||
    /(?:logout|signout|delete|remove|checkout|purchase|subscribe)/i.test(url.pathname)
  )
    throw new Error('Only same-origin public read endpoints are supported.');
  for (const [key, item] of url.searchParams) {
    if (
      !queryKeys.test(key) ||
      sensitive.test(key) ||
      item.length > 100 ||
      !/^[\w .,-]*$/.test(item)
    )
      throw new Error('Endpoint parameters cannot be safely retained.');
  }
  return url.href;
}

export function matchVisibleFields(body: string, before: string[], after: string[]): FieldMatch[] {
  const value: unknown = JSON.parse(body);
  const changed = new Set(
    after.map(normalized).filter((text) => !before.map(normalized).includes(text)),
  );
  const fields: FieldMatch[] = [];
  let visited = 0;
  function walk(item: unknown, path: string[]) {
    if (++visited > 2000 || path.length > 8 || fields.length >= 20) return;
    if (typeof item === 'string' || typeof item === 'number') {
      const text = normalized(String(item));
      if (text.length >= 3 && text.length <= 200 && changed.has(text))
        fields.push({ path, value: text, type: typeof item as 'string' | 'number' });
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (
          key.length > 100 ||
          sensitive.test(key) ||
          ['__proto__', 'constructor', 'prototype'].includes(key)
        )
          continue;
        walk(child, [...path, key]);
      }
    }
  }
  walk(value, []);
  return fields;
}

export function validateReplay(body: string, fields: FieldMatch[]) {
  const data: unknown = JSON.parse(body);
  if (!fields.length) throw new Error('No browser-backed field mapping.');
  for (const field of fields) {
    let current: unknown = data;
    for (const key of field.path) {
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, key))
        throw new Error('Response structure changed.');
      current = (current as Record<string, unknown>)[key];
    }
    if (typeof current !== field.type || normalized(String(current)) !== field.value)
      throw new Error('Response no longer matches the captured visible value.');
  }
  return fields.map((field) => ({ path: field.path, value: field.value }));
}

export class Interactions {
  private busy = false;
  constructor(
    private readonly dir: string,
    private readonly source: (id: string) => Promise<{ url: string; controls: ReadControl[] }>,
    private readonly capture: (url: string, control: ReadControl) => Promise<RenderedPage> = (
      url,
      control,
    ) => captureRenderedPage(url, undefined, control),
    private readonly reader: (url: string) => Promise<PublicPage> = readPublicPage,
  ) {}
  private path(id: string) {
    if (!/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error('Invalid website ID.');
    return join(this.dir, `interactions-${id}.json`);
  }
  async list(id: string): Promise<InteractionReport[]> {
    await this.source(id);
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  private async save(id: string, reports: InteractionReport[]) {
    await mkdir(this.dir, { recursive: true });
    const path = this.path(id);
    await writeFile(`${path}.tmp`, JSON.stringify(reports.slice(0, 20)), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  private async exclusive<T>(work: () => Promise<T>) {
    if (this.busy) throw new Error('An interaction check is already running. Please wait.');
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }
  async run(id: string, controlId: unknown) {
    return this.exclusive(async () => {
      const source = await this.source(id);
      const control = source.controls.find((item) => item.id === controlId);
      if (!control)
        throw new Error('Select an available pagination control. Rebuild the preview if needed.');
      const captured = await this.capture(source.url, control);
      if (!captured.interaction) throw new Error('No interaction observation returned.');
      const observed = captured.interaction;
      const report: InteractionReport = {
        id: randomUUID(),
        website_id: id,
        control,
        captured_at: new Date().toISOString(),
        candidates: [],
        limitations: [
          'Only GET JSON responses observed after the selected pagination action are candidates. Timing alone does not prove causality.',
          'Verification covers mapped fields for this exact URL and parameter set, not the entire API. No authentication or write actions are supported.',
          'Changed values are withheld until recaptured. Headers, cookies and raw response bodies are not persisted.',
        ],
      };
      const safeResponses = observed.responses
        .flatMap((response) => {
          try {
            return [{ ...response, url: replayUrl(response.url, new URL(source.url).origin) }];
          } catch {
            return [];
          }
        })
        .slice(0, 3);
      if (observed.responses.length > 3)
        report.limitations.push('At most three candidate responses are checked per capture.');
      if (safeResponses.length) {
        try {
          report.evidence = await inspectCloneCapture(
            safeResponses.map((response) =>
              captureRequest(response.url, response.mime, response.body),
            ),
            this.dir,
            'browser-response',
          );
        } catch {
          report.limitations.push('REA evidence unavailable. Replay remains disabled.');
        }
      }
      for (const response of safeResponses) {
        if (report.candidates.some((item) => item.url === response.url)) continue;
        const candidate: SourceCandidate = {
          id: randomUUID(),
          url: response.url,
          method: 'GET',
          status: 'unverified',
          fields: [],
          reason: 'No newly visible exact field match.',
        };
        try {
          candidate.fields = matchVisibleFields(response.body, observed.before, observed.after);
          if (candidate.fields.length && report.evidence?.status === 'verified') {
            const fresh = await this.reader(candidate.url);
            if (fresh.url !== candidate.url || !/json/i.test(fresh.contentType))
              throw new Error('Endpoint changed or is not JSON.');
            validateReplay(fresh.body, candidate.fields);
            candidate.status = 'verified';
            candidate.verified_at = new Date().toISOString();
            candidate.reason = 'Fresh GET matched newly visible fields and REA capture evidence.';
          }
        } catch {
          candidate.reason =
            'Fresh response could not be matched to the captured page. Replay disabled.';
        }
        report.candidates.push(candidate);
      }
      // Multiple endpoints matching the same visible field are ambiguous.
      for (const candidate of report.candidates) {
        if (
          candidate.fields.some((field) =>
            report.candidates.some(
              (other) =>
                other !== candidate && other.fields.some((item) => item.value === field.value),
            ),
          )
        ) {
          candidate.status = 'unverified';
          candidate.reason = 'Multiple responses match the same visible value. Replay disabled.';
        }
      }
      if (!report.candidates.length)
        report.limitations.push(
          'No supported same-origin JSON request was observed. Server-rendered navigation may not expose a JSON API.',
        );
      await this.save(id, [report, ...(await this.list(id))]);
      return report;
    });
  }
  async replay(id: string, candidateId: string) {
    return this.exclusive(async () => {
      const source = await this.source(id);
      const reports = await this.list(id);
      const report = reports.find((item) =>
        item.candidates.some((candidate) => candidate.id === candidateId),
      );
      const candidate = report?.candidates.find((item) => item.id === candidateId);
      if (!candidate || candidate.status !== 'verified' || report?.evidence?.status !== 'verified')
        throw new Error('This source endpoint is not verified for replay.');
      try {
        const url = replayUrl(candidate.url, new URL(source.url).origin);
        const response = await this.reader(url);
        if (response.url !== url || !/json/i.test(response.contentType))
          throw new Error('Source endpoint changed.');
        const fields = validateReplay(response.body, candidate.fields);
        return {
          kind: 'observed_source_replay',
          source: url,
          at: new Date().toISOString(),
          evidence_id: report.evidence.evidence_id,
          fields,
        };
      } catch {
        candidate.status = 'stale';
        candidate.reason = 'Replay failed or values changed. Capture the interaction again.';
        await this.save(id, reports);
        throw new Error(candidate.reason);
      }
    });
  }
}
