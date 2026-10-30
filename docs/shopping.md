# Shopping assistant

Choose Shopping Assistant, enter a product description or select Check a listing and paste a
public HTTPS URL. Check online saves the request and starts research. Save request only saves it.

TinyFish Search supplies candidate URLs, not verified products or prices. Fetch reads up to four
pages. A separate DNS-pinned read of the original URL preserves metadata removed by cleaned HTML.
The parser uses a unique Product object and offer, supported page fields, or unambiguous cleaned
price/stock statements. Multiple products or offers are not collapsed into a fabricated price.
Raw source instructions are never executed. Links and result text are rendered as DOM text.

Every result shows the source URL, check time, evidence paths and missing information. Original
metadata and cleaned-page price disagreements prevent ranking. Comparisons require the same
reported GTIN and currency and no conflicting model, brand, color or size. These identifiers and
prices remain source claims; no authenticity guarantee, seller certification or fraud score is
provided. Currency symbols alone do not establish a currency for ranking.

Local results can be reused for 15 minutes with an explicit cache notice. Run fresh bypasses this
local cache; TinyFish can still return upstream-cached content. Two checks can run concurrently,
with a 60-second result deadline. Cancel stops publishing results and prevents later stages;
requests already sent to the provider may finish. Restart marks unfinished jobs failed instead
of silently repeating them. Data is stored in ignored DATA_DIR/shopping.json.

Set up monitoring fills the existing website-inspection form. The user must analyze the listing
and approve fields before scheduled monitoring starts. No new external alerts are sent.

Not yet implemented: pincode-specific delivery interaction, final shipping/tax totals, independent
seller corroboration, and authenticity verification. Missing return terms are not proof of fraud.

Routes (existing authentication and mutation-origin checks apply):

- GET /api/shopping — saved jobs and results.
- POST /api/shopping — request_id and optional fresh boolean, returns a job immediately.
- POST /api/shopping/:id/cancel — cancel publication of the job result.

Validation includes deterministic provider fixtures and a bounded live TinyFish search/fetch smoke
check. Run `npx tsx scripts/shopping-smoke.ts` explicitly to repeat the provider check; it does not
start browser automation or print credentials.
