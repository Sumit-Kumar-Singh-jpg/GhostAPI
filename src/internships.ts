import { TinyFish } from '@tiny-fish/sdk';
import { load } from 'cheerio';
import { lookup } from 'node:dns/promises';
import { publicAddress } from './websites/public-read.js';
import { shoppingUrl, type ShoppingProvider, type ShoppingPage } from './shopping.js';
import { ResearchJobs } from './research-jobs.js';
import type { ResearchRequest } from './requests.js';

export type InternshipFinding = {
  kind: 'support' | 'warning' | 'question';
  title: string;
  explanation: string;
  source: string;
  excerpt: string;
};
export type InternshipResult = {
  partial: boolean;
  assessment: 'Supporting evidence found' | 'Needs verification' | 'Strong warning signs';
  checked_at: string;
  findings: InternshipFinding[];
  sources: { url: string; title: string }[];
  limitations: string[];
};
export const internshipProvider: ShoppingProvider = {
  async search(query) {
    if (!process.env.TINYFISH_API_KEY) throw new Error('TinyFish is not configured.');
    const result = await new TinyFish({ timeout: 18000, maxRetries: 0 }).search.query({
      query,
      purpose:
        'Find public employer and careers references for an internship. Results are leads, not proof of legitimacy.',
    });
    return result.results.slice(0, 5).map((item) => ({ url: item.url, title: item.title }));
  },
  async fetch(urls) {
    if (!process.env.TINYFISH_API_KEY) throw new Error('TinyFish is not configured.');
    for (const value of urls) {
      const url = new URL(shoppingUrl(value));
      const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
      if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
        throw new Error('Reference does not resolve to a public website.');
    }
    const response = await new TinyFish({ timeout: 18000, maxRetries: 0 }).fetch.getContents({
      urls: urls.map(shoppingUrl),
      format: 'html',
      include_html_head: true,
      ttl: 0,
      per_url_timeout_ms: 8000,
    });
    return response.results.flatMap((item) => {
      try {
        if (
          item.format !== 'html' ||
          typeof item.text !== 'string' ||
          item.text.length > 1024 * 1024
        )
          return [];
        return [{ url: shoppingUrl(item.final_url ?? item.url), html: item.text }];
      } catch {
        return [];
      }
    });
  },
};
const plain = (html: string) => {
  const $ = load(html);
  $('script,style,noscript').remove();
  $('p,li,h1,h2,h3,h4,div,section,br').append('\n');
  return $('body')
    .text()
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, 30000);
};
const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, '');
const sameHost = (a: string, b: string) => host(a) === host(b);
const canonical = (url: string) => {
  const u = new URL(url);
  u.hash = '';
  return u.href.replace(/\/$/, '');
};

export function warningFindings(text: string, source: string): InternshipFinding[] {
  const findings: InternshipFinding[] = [];
  const clauses = text
    .split(/(?:[.!?;\n]|\bbut\b|\bhowever\b|\bexcept\b)/i)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    // Negative safety advice must not become an accusation.
    if (/\b(?:no|never|not|don't|do not|avoid|beware)\b/i.test(clause)) continue;
    const payment =
      /\b(?:pay|transfer|deposit|send)\b.{0,100}\b(?:fee|deposit|payment|money|rupees|inr|usd)\b/i.test(
        clause,
      ) || /\b(?:registration|application|security|training) fee\b.{0,35}(?:₹|\$|\d)/i.test(clause);
    const credentials =
      /\b(?:send|share|provide|submit)\b.{0,80}\b(?:otp|password|bank pin|card pin|cvv)\b/i.test(
        clause,
      );
    if (payment || credentials)
      findings.push({
        kind: 'warning',
        title: payment ? 'Upfront payment request' : 'Account credential request',
        explanation: payment
          ? 'This text asks for money in the application context. Verify the requirement independently before paying; the excerpt alone does not establish fraud.'
          : 'This text asks for account credentials. Do not share passwords, OTPs or payment PINs.',
        source,
        excerpt: clause.slice(0, 350),
      });
  }
  return findings.slice(0, 8);
}

export async function researchInternship(
  request: ResearchRequest,
  provider: ShoppingProvider,
  cancelled: () => boolean,
): Promise<InternshipResult> {
  const result: InternshipResult = {
    partial: true,
    assessment: 'Needs verification',
    checked_at: new Date().toISOString(),
    findings: [],
    sources: [],
    limitations: [
      'This is a bounded review of public evidence, not a safe/fraud verdict or a background check.',
      'A company reference website supplied by you is a comparison baseline; GhostAPI does not certify ownership of that domain.',
      'Missing careers listings, external recruiting platforms or free email addresses alone do not prove fraud.',
      'TinyFish may return cached content. Dates show when GhostAPI checked the response. No applications or recruiter messages are sent.',
    ],
  };
  const listingUrl = /^https?:\/\/\S+$/i.test(request.input.trim())
    ? shoppingUrl(request.input.trim())
    : undefined;
  const reference = request.company_url ? shoppingUrl(request.company_url) : undefined;
  let listingText = listingUrl ? '' : request.input;
  let pages: ShoppingPage[] = [];
  const urls = [...new Set([listingUrl, reference].filter((value): value is string => !!value))];
  if (!urls.length)
    result.limitations.push(
      'Local text screening only: no public source was fetched for this description.',
    );
  if (cancelled()) throw new Error('Cancelled');
  if (urls.length) {
    try {
      pages = await provider.fetch(urls);
    } catch {
      result.limitations.push(
        'Initial source fetch failed; no positive verification was inferred.',
      );
    }
  }
  if (cancelled()) throw new Error('Cancelled');
  const listing = listingUrl
    ? pages.find((page) => canonical(page.url) === canonical(listingUrl))
    : undefined;
  if (
    listing &&
    !/access denied|captcha|robot check|sign in/i.test(
      load(listing.html)('h1,title').first().text(),
    )
  )
    listingText = plain(listing.html);
  else if (listingUrl)
    result.findings.push({
      kind: 'question',
      title: 'Listing unavailable',
      explanation:
        'The submitted page could not be read at its exact URL. A login wall, redirect or unavailable page cannot establish legitimacy or fraud.',
      source: listingUrl,
      excerpt: '',
    });
  result.findings.push(...warningFindings(listingText, listingUrl ?? 'Submitted description'));
  const referencePages = reference ? pages.filter((page) => sameHost(page.url, reference)) : [];
  const follow = new Set<string>();
  for (const page of referencePages) {
    const $ = load(page.html);
    $('a[href]').each((_, element) => {
      try {
        const url = shoppingUrl(new URL($(element).attr('href')!, page.url).href);
        if (
          sameHost(url, reference!) &&
          /career|jobs|internship/i.test($(element).text() + new URL(url).pathname) &&
          !pages.some((item) => item.url === url) &&
          follow.size < 2
        )
          follow.add(url);
      } catch {
        /* Ignore unsafe links. */
      }
    });
  }
  if (!reference && listing) {
    const title = load(listing.html)('h1')
      .first()
      .text()
      .replace(/[\w.+-]+@[\w.-]+/g, '')
      .replace(/\d{5,}/g, '')
      .slice(0, 120);
    if (title) {
      try {
        const found = await provider.search(`${title} internship company careers`);
        for (const item of found.slice(0, 2)) {
          try {
            result.sources.push({
              url: shoppingUrl(item.url),
              title: `Search lead, not verified: ${item.title.slice(0, 150)}`,
            });
          } catch {
            /* Unsafe search result. */
          }
        }
      } catch {
        result.limitations.push('Additional source search was unavailable.');
      }
    }
  }
  if (cancelled()) throw new Error('Cancelled');
  if (follow.size) {
    try {
      pages.push(...(await provider.fetch([...follow])));
    } catch {
      result.limitations.push('Linked careers pages could not be read.');
    }
  }
  if (cancelled()) throw new Error('Cancelled');
  for (const page of pages)
    result.sources.push({
      url: shoppingUrl(page.url),
      title:
        load(page.html)('h1,title').first().text().trim().slice(0, 160) ||
        new URL(page.url).hostname,
    });
  let corroborated = false;
  if (reference && listingUrl) {
    for (const page of pages.filter((item) => sameHost(item.url, reference))) {
      const $ = load(page.html);
      let linked = false;
      $('a[href]').each((_, element) => {
        try {
          if (canonical(new URL($(element).attr('href')!, page.url).href) === canonical(listingUrl))
            linked = true;
        } catch {
          /* Invalid link. */
        }
      });
      // A submitted listing cannot corroborate itself; require a different reference page.
      if (
        linked &&
        canonical(page.url) !== canonical(listingUrl) &&
        /intern|trainee|apprentice/i.test(listingText)
      ) {
        corroborated = true;
        result.findings.push({
          kind: 'support',
          title: 'Reference site links to this opportunity',
          explanation:
            'A separate page on your company reference domain links to the exact submitted listing. This supports association with that reference site, not domain ownership or employer legitimacy.',
          source: page.url,
          excerpt: listingUrl,
        });
      }
    }
    const emails = [
      ...new Set(listingText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
    ].slice(0, 5);
    for (const email of emails) {
      const domain = email.split('@')[1]!.toLowerCase();
      if (domain !== host(reference))
        result.findings.push({
          kind: 'question',
          title: 'Recruiter domain differs',
          explanation: `A contact uses ${domain}, while your reference site uses ${host(reference)}. Ask the company to confirm the recruiter; external recruiters can be legitimate.`,
          source: listingUrl,
          excerpt: `Contact domain: ${domain}`,
        });
    }
    if (listing) {
      const $ = load(listing.html);
      const applicationHosts = new Set<string>();
      $('a[href]').each((_, element) => {
        try {
          const destination = shoppingUrl(new URL($(element).attr('href')!, listing.url).href);
          if (/apply|application/i.test($(element).text()) && !sameHost(destination, reference))
            applicationHosts.add(host(destination));
        } catch {
          /* Unsupported application links are not opened. */
        }
      });
      for (const domain of [...applicationHosts].slice(0, 3))
        result.findings.push({
          kind: 'question',
          title: 'External application destination',
          explanation: `The application link goes to ${domain}, outside your reference domain. Confirm that this recruiting platform is authorized; a different domain alone is not fraud evidence.`,
          source: listingUrl,
          excerpt: `Application domain: ${domain}`,
        });
    }
  }
  if (!corroborated)
    result.findings.push({
      kind: 'question',
      title: reference ? 'Opportunity not corroborated' : 'Company reference needed',
      explanation: reference
        ? 'No separate page on the supplied reference domain linked to the exact listing within this check. That absence is not evidence of fraud.'
        : 'Add a company website you independently recognize to compare careers and recruiter domains. Search leads are not treated as official websites.',
      source: reference ?? 'Submitted description',
      excerpt: '',
    });
  if (!listingUrl)
    result.findings.push({
      kind: 'question',
      title: 'Description-only review',
      explanation:
        'Warning signs refer to the text you supplied. Provide the original listing URL to check where the opportunity is published.',
      source: 'Submitted description',
      excerpt: '',
    });
  result.assessment = result.findings.some((item) => item.kind === 'warning')
    ? 'Strong warning signs'
    : corroborated
      ? 'Supporting evidence found'
      : 'Needs verification';
  result.partial = !corroborated;
  return result;
}
export class InternshipJobs extends ResearchJobs<InternshipResult> {
  constructor(
    dir: string,
    request: (id: string) => ResearchRequest | undefined,
    provider: ShoppingProvider = internshipProvider,
  ) {
    super(dir, 'internships', request, (request, cancelled) =>
      researchInternship(request, provider, cancelled),
    );
  }
}
