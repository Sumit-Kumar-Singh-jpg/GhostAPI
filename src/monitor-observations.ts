import type { ShoppingResult } from './shopping.js';
import type { InternshipResult } from './internships.js';
export function shoppingValues(result: ShoppingResult) {
  return Object.fromEntries(
    result.listings.flatMap((listing) =>
      listing.facts.map((fact) => [`${listing.url} · ${fact.label}`, fact.value]),
    ),
  );
}
export function internshipValues(result: InternshipResult) {
  return {
    Assessment: result.assessment,
    Findings: result.findings
      .map((item) => `${item.kind}: ${item.title} — ${item.excerpt}`)
      .sort()
      .join('\n'),
  };
}
