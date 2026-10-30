import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { shoppingProvider, inspectListing } from '../src/shopping.js';

// Bounded provider check: one search and one public product-page fetch. Never log credentials.
try {
  const search = await shoppingProvider.search('Sony WH-1000XM5 headphones product');
  const pages = await shoppingProvider.fetch([
    'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
  ]);
  const listing = pages[0] ? inspectListing(pages[0]) : undefined;
  if (pages[0]) {
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/shopping-source.html', pages[0].html);
  }
  console.log(
    JSON.stringify({
      search_results: search.length,
      fetched_pages: pages.length,
      source: listing?.url,
      fact_labels: listing?.facts.map((fact) => fact.label),
      timestamp: listing?.checked_at,
    }),
  );
  if (!search.length || !listing?.facts.length) process.exitCode = 1;
} catch {
  console.error(
    'Shopping provider smoke check failed. No credentials or provider error payloads were logged.',
  );
  process.exitCode = 1;
}
