import { ResearchJobs } from './research-jobs.js';
import { TinyFish } from '@tiny-fish/sdk';
import { load } from 'cheerio';
import { publicUrl, publicAddress, readPublicPage } from './websites/public-read.js';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { inspectPage } from './websites/inspect.js';
import type { ResearchRequest } from './requests.js';

export type ShoppingPage = { url: string; html: string; source_html?: string };
export type ShoppingProvider = {
  search(query: string): Promise<{ url: string; title: string }[]>;
  fetch(urls: string[]): Promise<ShoppingPage[]>;
};
export function shoppingUrl(value: string) {
  const url = publicUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !publicAddress(hostname)) throw new Error('Use a public product URL.');
  return url.href;
}
export const shoppingProvider: ShoppingProvider = {
  async search(query) {
    if (!process.env.TINYFISH_API_KEY)
      throw new Error('Configure TinyFish locally before running shopping checks.');
    const result = await new TinyFish({ maxRetries: 0, timeout: 20000 }).search.query({
      query,
      purpose:
        'Find public product detail listings for comparison. Do not treat snippets as verified prices.',
    });
    return result.results.slice(0, 10).map((item) => ({ url: item.url, title: item.title }));
  },
  async fetch(urls) {
    if (!process.env.TINYFISH_API_KEY)
      throw new Error('Configure TinyFish locally before running shopping checks.');
    // Reject local/reserved destinations before sending URLs to a remote provider.
    for (const value of urls) {
      const url = new URL(shoppingUrl(value));
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
        throw new Error('A listing does not resolve to a public website.');
    }
    const result = await new TinyFish({ maxRetries: 0, timeout: 25000 }).fetch.getContents({
      urls,
      format: 'html',
      include_html_head: true,
      ttl: 0,
      per_url_timeout_ms: 12000,
    });
    const pages = result.results.flatMap((item) => {
      if (
        item.format !== 'html' ||
        typeof item.text !== 'string' ||
        !item.text.trim() ||
        item.text.length > 2 * 1024 * 1024
      )
        return [];
      try {
        return [{ url: shoppingUrl(item.final_url ?? item.url), html: item.text }];
      } catch {
        return [];
      }
    });
    return Promise.all(
      pages.map(async (page) => {
        try {
          const original = await readPublicPage(page.url);
          if (original.url === page.url && /html/i.test(original.contentType))
            return { ...page, source_html: original.body };
        } catch {
          /* A blocked original response does not erase readable TinyFish content. */
        }
        return page;
      }),
    );
  },
};
type Fact = { label: string; value: string; evidence: string };
export type ShoppingListing = {
  url: string;
  title: string;
  checked_at: string;
  facts: Fact[];
  concerns: string[];
  amount?: number;
  currency?: string;
  identity?: string;
};
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, 300)
    : '';
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export function inspectListing(page: ShoppingPage): ShoppingListing {
  const url = shoppingUrl(page.url);
  const $ = load(page.html);
  const metadata = page.source_html ? load(page.source_html) : $;
  const products: Record<string, unknown>[] = [];
  function scan(value: unknown, depth = 0) {
    if (depth > 8 || products.length > 10) return;
    if (Array.isArray(value)) {
      value.forEach((item) => scan(item, depth + 1));
      return;
    }
    const obj = record(value);
    if (!obj) return;
    if ([obj['@type']].flat().includes('Product')) products.push(obj);
    if (obj['@graph']) scan(obj['@graph'], depth + 1);
  }
  for (const node of metadata('script[type="application/ld+json"]').toArray()) {
    try {
      scan(JSON.parse(metadata(node).text()));
    } catch {
      /* Malformed metadata is not evidence. */
    }
  }
  const listing: ShoppingListing = {
    url,
    title: text($('h1').first().text() || $('title').text()) || new URL(url).hostname,
    checked_at: new Date().toISOString(),
    facts: [],
    concerns: [],
  };
  if (
    /captcha|access denied|robot check|verify you are human|sign in to continue/i.test(
      listing.title,
    )
  )
    throw new Error('The source returned a blocked page.');
  const add = (label: string, value: unknown, evidence: string) => {
    const clean = text(value);
    if (clean) listing.facts.push({ label, value: clean, evidence });
  };
  if (products.length === 1) {
    const p = products[0]!;
    listing.title = text(p.name) || listing.title;
    for (const key of [
      'brand',
      'model',
      'sku',
      'color',
      'size',
      'gtin',
      'gtin13',
      'gtin14',
      'gtin12',
    ])
      add(key, record(p[key])?.name ?? p[key], `Product.${key}`);
    const offers = Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers] : [];
    const offer = offers.length === 1 ? record(offers[0]) : undefined;
    if (offer) {
      add('price', offer.price, 'Product.offers.price');
      add('currency', offer.priceCurrency, 'Product.offers.priceCurrency');
      add('availability', text(offer.availability).split('/').pop(), 'Product.offers.availability');
      add('seller', record(offer.seller)?.name, 'Product.offers.seller.name');
      const policy = record(offer.hasMerchantReturnPolicy) ?? record(p.hasMerchantReturnPolicy);
      if (policy) {
        add(
          'return window (days)',
          policy.merchantReturnDays,
          'Product.hasMerchantReturnPolicy.merchantReturnDays',
        );
        add(
          'return policy',
          text(policy.returnPolicyCategory).split('/').pop(),
          'Product.hasMerchantReturnPolicy.returnPolicyCategory',
        );
      }
      const gtin = ['gtin14', 'gtin13', 'gtin12', 'gtin']
        .map((key) => text(p[key]))
        .find((value) => /^\d{12,14}$/.test(value));
      if (gtin) listing.identity = gtin.padStart(14, '0');
    } else
      listing.concerns.push(
        'Multiple or missing offers: a single price cannot be assigned to this variant.',
      );
  } else if (products.length > 1)
    listing.concerns.push(
      'Multiple products were found. Open one product detail page to avoid mixing variants.',
    );
  else {
    const inspection = inspectPage({
      url,
      body: page.source_html ?? page.html,
      contentType: 'text/html',
    });
    for (const field of inspection.fields.filter((field) =>
      ['price', 'currency', 'availability'].includes(field.key),
    ))
      add(
        field.key,
        field.sample,
        `Page field: ${field.extractor.kind === 'css' ? field.extractor.selector : field.key}`,
      );
    listing.concerns.push(
      'No unique structured product metadata; visible page fields may need manual confirmation.',
    );
    if (!listing.facts.some((fact) => fact.label === 'price') && $('h1').length === 1) {
      const priceText = text($('h1').next('p').text());
      if (/^(?:£|₹|\$|€|INR\s|USD\s|GBP\s|EUR\s)\s?\d+(?:,\d{3})*(?:\.\d{2})?$/.test(priceText))
        add('price', priceText, 'Cleaned page: paragraph immediately after product heading');
    }
    if (!listing.facts.some((fact) => fact.label === 'availability')) {
      const availability = $('p')
        .toArray()
        .map((el) => text($(el).text()))
        .filter((value) =>
          /^(?:in stock(?: \(\d+ available\))?|out of stock|sold out)$/i.test(value),
        );
      if (new Set(availability).size === 1)
        add('availability', availability[0], 'Cleaned page: explicit stock statement');
    }
  }
  const visiblePrice = $('h1').length === 1 ? text($('h1').next('p').text()) : '';
  const claimedPrice = listing.facts.find((fact) => fact.label === 'price')?.value;
  if (
    claimedPrice &&
    visiblePrice &&
    /^(?:£|₹|\$|€)\s?\d+(?:\.\d{2})?$/.test(visiblePrice) &&
    /^\d+(?:\.\d+)?$/.test(claimedPrice) &&
    Number(visiblePrice.replace(/[^\d.]/g, '')) !== Number(claimedPrice)
  ) {
    listing.concerns.push(
      'Original metadata and the cleaned page show different prices. Price comparison withheld.',
    );
    listing.identity = undefined;
    add('other visible price', visiblePrice, 'Cleaned page: paragraph after heading');
  }
  const price = listing.facts.find((fact) => fact.label === 'price')?.value;
  const currency = listing.facts.find((fact) => fact.label === 'currency')?.value;
  if (
    price &&
    /^\d+(?:\.\d{1,4})?$/.test(price) &&
    Number.isFinite(Number(price)) &&
    Number(price) > 0 &&
    currency &&
    /^[A-Z]{3}$/.test(currency)
  ) {
    listing.amount = Number(price);
    listing.currency = currency;
  }
  if (!listing.facts.some((fact) => fact.label === 'seller'))
    listing.concerns.push('Seller identity was not found in supported listing metadata.');
  if (!listing.facts.some((fact) => fact.label.startsWith('return')))
    listing.concerns.push('Return terms were not found in supported listing metadata.');
  listing.concerns.push(
    'Delivery to your address, shipping costs, taxes and product authenticity have not been verified.',
  );
  return listing;
}

export type ShoppingResult = {
  partial: boolean;
  listings: ShoppingListing[];
  comparisons: { identity: string; currency: string; lowest: number; urls: string[] }[];
  limitations: string[];
};
export async function researchShopping(
  request: ResearchRequest,
  provider: ShoppingProvider,
  cancelled: () => boolean,
): Promise<ShoppingResult> {
  if (cancelled()) throw new Error('Cancelled');
  const candidates =
    request.intent === 'check_listing'
      ? [{ url: shoppingUrl(request.input), title: '' }]
      : await provider.search(request.input.slice(0, 500));
  if (cancelled()) throw new Error('Cancelled');
  const urls = [
    ...new Set(
      candidates.flatMap((item) => {
        try {
          return [shoppingUrl(item.url)];
        } catch {
          return [];
        }
      }),
    ),
  ].slice(0, 4);
  if (!urls.length)
    throw new Error(
      'No supported public listing URLs were found. Try a more specific model or paste a product URL.',
    );
  const pages = await provider.fetch(urls);
  if (cancelled()) throw new Error('Cancelled');
  const listings = [
    ...new Map(
      pages.flatMap((page) => {
        try {
          return [[page.url, inspectListing(page)] as const];
        } catch {
          return [];
        }
      }),
    ).values(),
  ];
  if (!listings.length)
    throw new Error(
      'No readable listing pages returned. The site may be blocking access; try another listing.',
    );
  const groups = new Map<string, ShoppingListing[]>();
  for (const listing of listings)
    if (listing.identity && listing.currency && listing.amount) {
      const key = `${listing.identity}:${listing.currency}`;
      groups.set(key, [...(groups.get(key) ?? []), listing]);
    }
  const comparisons = [...groups.values()]
    .filter((group) => {
      if (group.length < 2) return false;
      const conflict = ['brand', 'model', 'color', 'size'].some(
        (label) =>
          new Set(
            group.flatMap((item) =>
              item.facts
                .filter((fact) => fact.label === label)
                .map((fact) => fact.value.toLowerCase()),
            ),
          ).size > 1,
      );
      if (conflict)
        for (const item of group)
          item.concerns.push(
            'Listings with the same reported GTIN disagree on model or variant details. Price ranking withheld.',
          );
      return !conflict;
    })
    .map((group) => ({
      identity: group[0]!.identity!,
      currency: group[0]!.currency!,
      lowest: Math.min(...group.map((item) => item.amount!)),
      urls: group.map((item) => item.url),
    }));
  return {
    partial:
      listings.length < urls.length ||
      listings.some(
        (item) => !item.amount || !item.facts.some((fact) => fact.label === 'availability'),
      ),
    listings,
    comparisons,
    limitations: [
      `Read ${listings.length} of up to ${urls.length} candidate pages. Search results are candidates, not confirmed exact matches.`,
      'Facts are claims made by the source listing, not independent authenticity or seller verification.',
      'Only identical reported GTINs in the same currency are price-compared. No currency conversion or total-delivered-price ranking.',
      'TinyFish may return cached page content even when a fresh fetch is requested. Times show when GhostAPI checked the response.',
      ...(comparisons.length
        ? []
        : ['No confirmed comparable group found. Check model, size and color manually.']),
    ],
  };
}

export type ShoppingJob = import('./research-jobs.js').ResearchJob<ShoppingResult>;
export class ShoppingJobs extends ResearchJobs<ShoppingResult> {
  constructor(
    dir: string,
    request: (id: string) => ResearchRequest | undefined,
    provider: ShoppingProvider = shoppingProvider,
  ) {
    super(dir, 'shopping', request, (request, cancelled) =>
      researchShopping(request, provider, cancelled),
    );
  }
}
