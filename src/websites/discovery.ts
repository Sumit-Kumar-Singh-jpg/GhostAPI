import { TinyFish } from '@tiny-fish/sdk';
import { load } from 'cheerio';
import { publicUrl, type PublicPage } from './public-read.js';

export type Discovery = {
  provider: string;
  pages: { url: string; title: string; content: string }[];
  limitations: string[];
};
export async function discoverWebsite(page: PublicPage): Promise<Discovery> {
  const urls = new Set([page.url]);
  const $ = load(page.body);
  $('a[href]').each((_, element) => {
    try {
      const url = publicUrl(new URL($(element).attr('href')!, page.url).href);
      if (
        url.origin === new URL(page.url).origin &&
        !url.search &&
        !/logout|delete|checkout|cart|login|signout|download/i.test(url.pathname) &&
        urls.size < 5
      )
        urls.add(url.href);
    } catch {
      /* Ignore unsupported links. */
    }
  });
  const response = await new TinyFish({ maxRetries: 0, timeout: 60000 }).fetch.getContents({
    urls: [...urls],
    format: 'markdown',
    ttl: 0,
    per_url_timeout_ms: 15000,
  });
  const pages = response.results.flatMap((result) => {
    if (typeof result.text !== 'string' || !result.text.trim()) return [];
    try {
      const url = publicUrl(result.final_url ?? result.url);
      if (url.origin !== new URL(page.url).origin) return [];
      return [
        {
          url: url.href,
          title: (result.title ?? url.pathname).slice(0, 200),
          content: result.text.slice(0, 6000),
        },
      ];
    } catch {
      return [];
    }
  });
  if (!pages.length) throw new Error('TinyFish returned no readable public pages.');
  return {
    provider: 'TinyFish Fetch',
    pages,
    limitations: [
      'Preview of up to five linked public pages. This is not a complete crawl or access to private source code.',
      'Only approved fields on the submitted page are monitored. Analyze another page to monitor its fields.',
      'TinyFish may serve cached content. Monitoring validates fresh original responses separately.',
      ...(response.errors.length ? [`${response.errors.length} pages could not be read.`] : []),
    ],
  };
}
