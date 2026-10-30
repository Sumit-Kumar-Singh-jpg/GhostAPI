# Source API discovery (Phase 3)

Keep development local. This feature uses disposable local Chrome and the installed REA CLI;
it does not start paid TinyFish sessions or publish the app.

## Use

1. Inspect a public URL and rebuild its preview. Capture version 6 includes pagination controls.
2. In **Discover source APIs**, choose a supported Next / Load more / Show more control.
   Clicking a blue outline in the frozen preview selects the same control without navigating.
3. Select **Capture interaction**. A separate guarded browser loads the original page, checks
   that the chosen control still has the same identity, records visible text, and clicks it.
4. Review the source endpoint, JSON field paths and observed values, verification status and REA
   evidence. Candidates with no exact changed visible value, ambiguous matches, unavailable
   evidence or failed fresh reads cannot be replayed.
5. **Test source API** runs a fresh public GET. Only mapped fields are returned. If structure,
   field types or values change, the response is withheld and the mapping becomes stale.
   Capture the interaction again to establish new evidence.

## Scope and evidence

GET-only network interception still uses DNS-pinned public transport and fresh browser contexts.
No browser credentials are forwarded. Page scripts execute only in the isolated capture browser.
The existing frozen preview remains script-free. Arbitrary selectors cannot be submitted to the
capture API; control IDs come from the stored preview and are checked again against the source.

Browser response events identify JSON responses requested after the action started. Their metadata
is converted into a sanitized HAR for REA. HARs omit headers, cookies, query values and raw bodies;
successful REA parsing and artifact-digest verification establish provenance, not semantic accuracy.
Safe replay URLs retain a restricted set of public parameters separately in the interaction report.
JSON paths, types and newly visible exact values establish the limited field mapping. Timing alone
does not prove which request caused a UI change. Duplicate endpoints matching the same value are
treated as ambiguous.

Supported parameters: page, offset, limit, q, query, search, sort, order, category, id, product,
per_page; values have restricted characters and length. Opaque cursors and credential parameters
are excluded. Only same-origin public JSON endpoints qualify. At most three responses per capture,
20 mapped fields per response and 20 reports per website are retained. One interaction operation
runs at a time. Search forms, parameterized clients, authenticated APIs and automatic client repair
are future work. A GET method is not a general guarantee of a third-party endpoint's behavior.

## Storage and routes

`DATA_DIR/interactions-ID.json` stores reports, not raw response payloads. HAR/REA evidence is saved
under the existing ignored captures directory. Existing access control and mutation-origin checks
apply. API IDs and URLs are server-derived; replay cannot accept a replacement URL from a caller.

- GET `/api/websites/:id/interactions`: saved reports; does not launch a browser.
- POST `/api/websites/:id/interactions`: `{control_id}` starts a bounded capture and fresh verification.
- POST `/api/websites/:id/source-apis/:candidate/replay`: revalidate and return mapped fields, or 409.

Generated extraction routes remain independent. A discovered endpoint is never silently substituted
into an approved extraction contract or monitoring job.
