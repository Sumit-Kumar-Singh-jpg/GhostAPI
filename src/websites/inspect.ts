import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { PublicPage } from './public-read.js';

export type Extractor =
  | { kind: 'css'; selector: string; attribute?: string }
  | { kind: 'product'; property: string }
  | { kind: 'json'; key: string };
export type Field = { key: string; label: string; extractor: Extractor; sample: string };
export type Inspection = {
  at: string;
  url: string;
  title: string;
  sha256: string;
  fields: Field[];
  links: string[];
  notes: string[];
};
const clean = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, 1200)
    : '';
function productIn(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 10 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    const found = value.map((v) => productIn(v, depth + 1)).filter(Boolean);
    return found.length === 1 ? found[0] : undefined;
  }
  const obj = value as Record<string, unknown>;
  const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
  if (types.includes('Product')) return obj;
  if (obj['@graph']) return productIn(obj['@graph'], depth + 1);
}
function context(page: PublicPage) {
  const $ = load(page.body);
  let json: Record<string, unknown> = {};
  if (/application\/(?:ld\+)?json/i.test(page.contentType)) {
    try {
      const parsed = JSON.parse(page.body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed;
    } catch {
      /* No inferred fields from malformed JSON. */
    }
  }
  const products: Record<string, unknown>[] = [];
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const product = productIn(JSON.parse($(element).text()));
      if (product) products.push(product);
    } catch {
      /* Ignore invalid metadata. */
    }
  }
  const product = products.length === 1 ? products[0] : undefined;
  return { $, json, product };
}
function read(extractor: Extractor, ctx: ReturnType<typeof context>): string {
  if (extractor.kind === 'json') return clean(ctx.json[extractor.key]);
  if (extractor.kind === 'product') {
    if (!ctx.product) return '';
    if (extractor.property === 'name') return clean(ctx.product.name);
    const offer = Array.isArray(ctx.product.offers)
      ? ctx.product.offers.length === 1
        ? ctx.product.offers[0]
        : undefined
      : ctx.product.offers;
    return offer && typeof offer === 'object'
      ? clean((offer as Record<string, unknown>)[extractor.property])
      : '';
  }
  const nodes = ctx.$(extractor.selector);
  if (nodes.length !== 1) return '';
  return clean(extractor.attribute ? nodes.attr(extractor.attribute) : nodes.text());
}
export function inspectPage(page: PublicPage): Inspection {
  const ctx = context(page),
    fields: Field[] = [];
  const add = (key: string, label: string, options: Extractor[]) => {
    for (const extractor of options) {
      const sample = read(extractor, ctx);
      if (sample) {
        fields.push({ key, label, extractor, sample });
        return;
      }
    }
  };
  const css = (selector: string, attribute?: string): Extractor => ({
    kind: 'css',
    selector,
    ...(attribute ? { attribute } : {}),
  });
  const product = (property: string): Extractor => ({ kind: 'product', property });
  if (/json/i.test(page.contentType)) {
    for (const key of Object.keys(ctx.json).slice(0, 20)) {
      if (/password|secret|token|api.?key|authorization/i.test(key)) continue;
      add(`json_${key}`, key, [{ kind: 'json', key }]);
    }
  } else {
    add('title', 'Title', [
      product('name'),
      css('h1'),
      css('meta[property="og:title"]', 'content'),
      css('title'),
    ]);
    add('price', 'Price', [
      product('price'),
      css('[itemprop="price"]', 'content'),
      css('meta[property="product:price:amount"]', 'content'),
      css('[data-testid="price"]'),
      css('.price_color'),
      css('[itemprop="price"]'),
      css('.product-price'),
      css('.price'),
    ]);
    add('currency', 'Currency', [
      product('priceCurrency'),
      css('[itemprop="priceCurrency"]', 'content'),
      css('meta[property="product:price:currency"]', 'content'),
    ]);
    add('availability', 'Availability', [
      product('availability'),
      css('[itemprop="availability"]', 'href'),
      css('[data-testid="availability"]'),
      css('.availability'),
      css('.stock'),
    ]);
    add('description', 'Description', [
      css('meta[name="description"]', 'content'),
      css('meta[property="og:description"]', 'content'),
    ]);
  }
  const links = new Set<string>();
  ctx.$('a[href], link[rel="alternate"][href]').each((_, el) => {
    try {
      const url = new URL(ctx.$(el).attr('href')!, page.url);
      if (
        url.origin === new URL(page.url).origin &&
        /\.json(?:$|\?)|\/api\//i.test(url.href) &&
        links.size < 10 &&
        !/token|secret|password|key=/i.test(url.href)
      )
        links.add(url.href);
    } catch {
      /* Invalid link. */
    }
  });
  return {
    at: new Date().toISOString(),
    url: page.url,
    title: fields.find((f) => f.key === 'title')?.sample ?? new URL(page.url).hostname,
    sha256: createHash('sha256').update(page.body).digest('hex'),
    fields,
    links: [...links],
    notes: [
      'Inspection reads public HTML, structured product metadata, or top-level JSON. JavaScript and sign-in flows are not executed.',
      'Data links are discovered from page markup; they are not observed network requests.',
      'Verification checks the approved source and required fields. It does not independently certify the website’s values.',
    ],
  };
}
export function extract(page: PublicPage, fields: Field[], approvedOrigin: string) {
  if (new URL(page.url).origin !== approvedOrigin)
    throw new Error('Website redirected outside the approved source origin.');
  const ctx = context(page),
    data: Record<string, string> = {},
    missing: string[] = [];
  for (const field of fields) {
    const value = read(field.extractor, ctx);
    if (!value) missing.push(field.key);
    else data[field.key] = value;
  }
  return { data, missing };
}
