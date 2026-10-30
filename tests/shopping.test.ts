import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectListing,
  researchShopping,
  ShoppingJobs,
  shoppingUrl,
  type ShoppingProvider,
} from '../src/shopping.js';
import type { ResearchRequest } from '../src/requests.js';

const request: ResearchRequest = {
  id: 'fixture',
  tool: 'shopping',
  intent: 'find_product',
  input: 'Example headphones',
  created_at: new Date().toISOString(),
  status: 'not_checked',
};
const product = (price: number, currency = 'INR', color = 'black') =>
  `<h1>Headphones</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Example headphones', gtin13: '1234567890128', model: 'H100', color, offers: { '@type': 'Offer', price, priceCurrency: currency, availability: 'https://schema.org/InStock', seller: { name: 'Example seller' } } })}</script>`;

test('Listing facts preserve provenance, missing return terms and authenticity limits', () => {
  const listing = inspectListing({ url: 'https://shop.example/item', html: product(999) });
  assert.equal(listing.amount, 999);
  assert.equal(listing.currency, 'INR');
  assert.ok(
    listing.facts.some(
      (fact) => fact.label === 'seller' && fact.evidence === 'Product.offers.seller.name',
    ),
  );
  assert.ok(listing.concerns.some((note) => note.includes('Return terms')));
  assert.ok(listing.concerns.some((note) => note.includes('authenticity')));
  const multiple = inspectListing({
    url: 'https://shop.example/item',
    html: product(999) + product(100),
  });
  assert.equal(multiple.amount, undefined);
  assert.ok(multiple.concerns.some((note) => note.includes('Multiple products')));
  assert.throws(() => shoppingUrl('https://127.0.0.1/'));
});

test('Comparisons never mix currencies or conflicting variants; unsafe search URLs are excluded', async () => {
  let color = 'black';
  const provider: ShoppingProvider = {
    search: async () => [
      { url: 'https://shop.example/a', title: '' },
      { url: 'https://shop.example/b', title: '' },
      { url: 'https://other.example/c', title: '' },
      { url: 'https://127.0.0.1/admin', title: '' },
    ],
    fetch: async (urls) =>
      urls.map((url, i) => ({
        url,
        html: product(i ? 800 : 900, i === 2 ? 'USD' : 'INR', i === 1 ? color : 'black'),
      })),
  };
  const result = await researchShopping(request, provider, () => false);
  assert.equal(result.listings.length, 3);
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0]?.currency, 'INR');
  assert.equal(result.comparisons[0]?.lowest, 800);
  color = 'white';
  assert.equal((await researchShopping(request, provider, () => false)).comparisons.length, 0);
});

test('Shopping jobs deduplicate, cache, support fresh reads and persist results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-shopping-'));
  let searches = 0;
  const provider: ShoppingProvider = {
    search: async () => {
      searches++;
      return [{ url: 'https://shop.example/item', title: '' }];
    },
    fetch: async (urls) => urls.map((url) => ({ url, html: product(100) })),
  };
  const jobs = new ShoppingJobs(dir, () => request, provider);
  await jobs.load();
  const first = await Promise.all([jobs.start(request.id, false), jobs.start(request.id, false)]);
  assert.equal(first[0]!.job.id, first[1]!.job.id);
  while (jobs.list()[0]?.status === 'running')
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await jobs.start(request.id, false)).cached, true);
  assert.equal(searches, 1);
  await jobs.start(request.id, true);
  while (jobs.list()[0]?.status === 'running')
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(searches, 2);
  await jobs.close();
  const restored = new ShoppingJobs(dir, () => request, provider);
  await restored.load();
  assert.equal(restored.list()[0]?.result?.listings[0]?.amount, 100);
  await restored.close();
});

test('Cancellation discards late provider results and never starts a fetch after cancelled search', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-shopping-cancel-'));
  let finish!: (value: { url: string; title: string }[]) => void;
  let fetched = false;
  const provider: ShoppingProvider = {
    search: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    fetch: async () => {
      fetched = true;
      return [];
    },
  };
  const jobs = new ShoppingJobs(dir, () => request, provider);
  await jobs.load();
  const started = await jobs.start(request.id, false);
  await jobs.cancel(started.job.id);
  finish([{ url: 'https://shop.example/item', title: '' }]);
  await jobs.close();
  assert.equal(fetched, false);
  assert.equal(jobs.list()[0]?.status, 'cancelled');
  assert.equal(jobs.list()[0]?.result, undefined);
  assert.match(await readFile(join(dir, 'shopping.json'), 'utf8'), /cancelled/);
});

test('Blocked sources fail honestly without inventing product facts', async () => {
  const provider: ShoppingProvider = {
    search: async () => [{ url: 'https://shop.example/item', title: 'Cheap product' }],
    fetch: async () => [],
  };
  await assert.rejects(
    researchShopping(request, provider, () => false),
    /No readable listing/,
  );
});

test('Cleaned HTML retains explicit facts and conflicting original metadata is excluded from ranking', () => {
  const html = '<h1>Headphones</h1><p>₹799.00</p><p>In stock</p>';
  const cleaned = inspectListing({ url: 'https://shop.example/item', html });
  assert.equal(cleaned.facts.find((fact) => fact.label === 'price')?.value, '₹799.00');
  assert.equal(cleaned.facts.find((fact) => fact.label === 'availability')?.value, 'In stock');
  const conflict = inspectListing({
    url: 'https://shop.example/item',
    html,
    source_html: product(999),
  });
  assert.equal(conflict.identity, undefined);
  assert.ok(conflict.concerns.some((note) => note.includes('different prices')));
  assert.throws(
    () => inspectListing({ url: 'https://shop.example/item', html: '<h1>Access denied</h1>' }),
    /blocked page/,
  );
});
