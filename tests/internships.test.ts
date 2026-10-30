import test from 'node:test';
import assert from 'node:assert/strict';
import { warningFindings, researchInternship, InternshipJobs } from '../src/internships.js';
import { validateRequest, type ResearchRequest } from '../src/requests.js';
import type { ShoppingProvider } from '../src/shopping.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const request: ResearchRequest = {
  id: 'internship',
  tool: 'internships',
  intent: 'check_internship',
  input: 'https://jobs.example/role',
  company_url: 'https://company.example/',
  status: 'not_checked',
  created_at: new Date().toISOString(),
};
function provider(
  linked: boolean,
  body = '<h1>Engineering internship</h1><p>Paid internship. We never charge application fees.</p>',
): ShoppingProvider {
  return {
    search: async () => [],
    fetch: async (urls) =>
      urls.map((url) => ({
        url,
        html:
          url === request.input
            ? body
            : linked
              ? `<h1>Careers</h1><a href="${request.input}">Engineering internship</a>`
              : '<h1>Company</h1><p>Public information only.</p>',
      })),
  };
}
test('Explicit payment and credential requests are warnings; negated advice is not', () => {
  assert.equal(
    warningFindings(
      'Please pay a registration fee of INR 500. Share your OTP to join.',
      'description',
    ).length,
    2,
  );
  assert.equal(
    warningFindings(
      'We never charge application fees. Do not share your OTP. Paid internship with a stipend.',
      'description',
    ).length,
    0,
  );
});
test('Separate reference link supports association without claiming safety or domain ownership', async () => {
  const result = await researchInternship(request, provider(true), () => false);
  assert.equal(result.assessment, 'Supporting evidence found');
  assert.ok(
    result.findings.some((item) => item.kind === 'support' && item.source === request.company_url),
  );
  assert.ok(result.limitations.some((note) => note.includes('not certify ownership')));
});
test('Missing careers evidence and external recruiting domains remain questions, not fraud', async () => {
  const result = await researchInternship(
    request,
    provider(
      false,
      '<h1>Engineering internship</h1><p>Contact recruiter@gmail.com</p><a href="https://ats.example/apply">Apply now</a>',
    ),
    () => false,
  );
  assert.equal(result.assessment, 'Needs verification');
  assert.ok(result.findings.some((item) => item.title === 'Recruiter domain differs'));
  assert.ok(result.findings.some((item) => item.title === 'External application destination'));
  assert.equal(result.findings.filter((item) => item.kind === 'warning').length, 0);
});
test('Warning signs take precedence over a reference link and blocked pages never get positive verification', async () => {
  const suspicious = await researchInternship(
    request,
    provider(true, '<h1>Internship</h1><p>Pay the application fee of INR 500 before joining.</p>'),
    () => false,
  );
  assert.equal(suspicious.assessment, 'Strong warning signs');
  const contradictory = await researchInternship(
    request,
    provider(
      true,
      '<h1>Internship</h1><p>We never charge a fee</p><p>Pay a registration fee of INR 500</p>',
    ),
    () => false,
  );
  assert.equal(contradictory.assessment, 'Strong warning signs');
  const blocked = await researchInternship(
    request,
    provider(true, '<h1>Access denied</h1>'),
    () => false,
  );
  assert.equal(blocked.assessment, 'Needs verification');
});
test('Description-only review does not send private text to search and provider failures stay uncertain', async () => {
  const offline: ShoppingProvider = {
    search: async () => {
      throw new Error('Must not search private description');
    },
    fetch: async () => {
      throw new Error('Unavailable');
    },
  };
  const described = await researchInternship(
    {
      ...request,
      company_url: undefined,
      input: 'Please send your password to apply for this internship.',
    },
    offline,
    () => false,
  );
  assert.equal(described.assessment, 'Strong warning signs');
  assert.equal(described.sources.length, 0);
  const unavailable = await researchInternship(request, offline, () => false);
  assert.equal(unavailable.assessment, 'Needs verification');
  assert.equal(unavailable.partial, true);
});
test('Company reference is validated and internship results persist with cache reuse', async () => {
  assert.throws(() => validateRequest({ ...request, company_url: 'http://localhost' }));
  assert.equal(validateRequest(request).company_url, request.company_url);
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-internships-'));
  const jobs = new InternshipJobs(dir, () => request, provider(true));
  await jobs.load();
  await jobs.start(request.id, false);
  while (jobs.list()[0]?.status === 'running')
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await jobs.start(request.id, false)).cached, true);
  await jobs.close();
  const restored = new InternshipJobs(dir, () => request, provider(false));
  await restored.load();
  assert.equal(restored.list()[0]?.result?.assessment, 'Supporting evidence found');
  await restored.close();
});
