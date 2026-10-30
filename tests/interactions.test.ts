import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureRenderedPage } from '../src/websites/render.js';
import {
  Interactions,
  matchVisibleFields,
  replayUrl,
  validateReplay,
} from '../src/websites/interactions.js';

test('Visible mapping requires changed exact values and rejects changed replay data', () => {
  const fields = matchVisibleFields(
    JSON.stringify({
      title: 'New book',
      count: 2,
      email: 'private@example.com',
      unchanged: 'Old book',
    }),
    ['Old book'],
    ['New book', '2', 'private@example.com', 'Old book'],
  );
  assert.deepEqual(fields, [{ path: ['title'], value: 'New book', type: 'string' }]);
  assert.deepEqual(validateReplay('{"title":"New book"}', fields), [
    { path: ['title'], value: 'New book' },
  ]);
  assert.throws(() => validateReplay('{"title":"Different book"}', fields));
  assert.throws(() => validateReplay('{"title":123}', fields));
  assert.throws(() => validateReplay('{}', fields));
  for (const url of [
    'https://outside.example/api?page=2',
    'https://fixture.example/api?token=secret',
    'https://fixture.example/api?cursor=secret',
    'https://fixture.example/delete?id=2',
  ])
    assert.throws(() => replayUrl(url, 'https://fixture.example'));
});

test('Real browser interaction and REA evidence enable bounded replay; changed values are withheld and persisted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-interaction-'));
  let title = 'Second product';
  const reads: string[] = [];
  const reader = async (url: string) => {
    reads.push(url);
    if (url === 'https://fixture.example/')
      return {
        url,
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Products</h1><p id="product">First product</p><button id="next">Next</button><script>document.querySelector("#next").onclick=async()=>{const data=await(await fetch("/api/products?page=2")).json();document.querySelector("#product").textContent=data.title;fetch("/purchase",{method:"POST"}).catch(()=>{});};</script></body></html>',
      };
    if (url.endsWith('/api/products?page=2'))
      return {
        url,
        contentType: 'application/json',
        body: JSON.stringify({ title, token: 'never-persist-this-secret' }),
      };
    throw new Error('Unexpected URL');
  };
  const control = { id: 'page-0', label: 'Next', href: null };
  const source = async () => ({ url: 'https://fixture.example/', controls: [control] });
  const interactions = new Interactions(
    dir,
    source,
    (url, selected) => captureRenderedPage(url, reader, selected),
    reader,
  );
  const report = await interactions.run('fixture', 'page-0');
  assert.equal(report.evidence?.status, 'verified');
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0]?.status, 'verified');
  assert.ok(!reads.some((url) => url.includes('/purchase')));
  const candidateId = report.candidates[0]!.id;
  assert.equal(
    (await interactions.replay('fixture', candidateId)).fields[0]?.value,
    'Second product',
  );
  title = 'Changed product';
  await assert.rejects(interactions.replay('fixture', candidateId), /values changed/);
  const restored = new Interactions(dir, source, undefined, reader);
  assert.equal((await restored.list('fixture'))[0]?.candidates[0]?.status, 'stale');
  await assert.rejects(restored.replay('fixture', candidateId), /not verified/);
  assert.doesNotMatch(
    await readFile(join(dir, 'interactions-fixture.json'), 'utf8'),
    /never-persist-this-secret/,
  );
  for (const filename of await readdir(join(dir, 'captures')))
    assert.doesNotMatch(
      await readFile(join(dir, 'captures', filename), 'utf8'),
      /never-persist-this-secret/,
    );
});

test('Changed control identity is rejected before clicking', async () => {
  await assert.rejects(
    captureRenderedPage(
      'https://fixture.example/',
      async (url) => ({ url, contentType: 'text/html', body: '<button>Next</button>' }),
      { id: 'page-0', label: 'Load more', href: null },
    ),
    /control changed/,
  );
});

test('Ambiguous responses remain unverified even when each fresh GET matches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-ambiguous-'));
  const control = { id: 'page-0', label: 'Next', href: null };
  const reader = async (url: string) => ({
    url,
    contentType: 'application/json',
    body: '{"title":"Second product"}',
  });
  const interactions = new Interactions(
    dir,
    async () => ({ url: 'https://fixture.example/', controls: [control] }),
    async () => ({
      page: { url: 'https://fixture.example/', contentType: 'text/html', body: '' },
      assets: new Map(),
      requests: [],
      screenshot: '',
      warnings: [],
      interaction: {
        before: ['First product'],
        after: ['Second product'],
        responses: [
          {
            url: 'https://fixture.example/api/one',
            mime: 'application/json',
            body: '{"title":"Second product"}',
          },
          {
            url: 'https://fixture.example/api/two',
            mime: 'application/json',
            body: '{"title":"Second product"}',
          },
        ],
      },
    }),
    reader,
  );
  const report = await interactions.run('fixture', 'page-0');
  assert.equal(report.candidates.length, 2);
  assert.ok(report.candidates.every((candidate) => candidate.status === 'unverified'));
  await assert.rejects(interactions.replay('fixture', report.candidates[0]!.id), /not verified/);
});
