# Delivery implementation phases

1. **Single-PIN delivery checks:** validate inputs and verdicts; verify TinyFish live-view capabilities; select one supported retailer; implement persisted jobs, bounded automation, authenticated API and Shopping UI with execution viewer/fallback. Gate completion on live evidence and failure-path tests.
2. **Three-PIN matrix — implemented:** isolated runs, shared limits, independent evidence and selectable live view. Display actual outcomes, including matching outcomes and partial failures.
3. **Workflow publishing — implemented for the supported delivery engine:** propose a product-specific contract from observed evidence, review, version, publish and invoke through a documented authenticated API. See delivery-workflows.md.
4. **Monitoring and reviewed recovery — implemented for the existing delivery engine:** opt-in checks, observed differences, failure classification and validated replacement versions. General structural code repair remains outside this bounded milestone. See delivery-monitoring.md.

## Phase 1 progress

Implemented input validation and conservative verdict evaluation, with tests for PIN/variant mismatch, missing evidence, explicit rejection and unknown availability. These functions evaluate agent-reported observations; they do not independently certify page evidence.

Implemented the TinyFish streaming adapter, persisted delivery jobs, authenticated submission/poll/cancel routes and a Shopping delivery form. Live-view URLs are ephemeral and open externally; they are excluded from stored records. Local cancellation aborts the stream and discards late results, but does not guarantee remote cancellation. Concurrency is two runs and the persisted rolling daily limit is 30 starts. No automatic retries occur.

The integration accepts Amazon India product-detail URLs as an experimental scope. Phase 1's bounded local delivery flow is implemented and one live listing/PIN check has passed. A provider-reported result is not an independently certified observation. An inline viewer now displays provider sessions with an external fallback; fresh live embedding verification is blocked by provider HTTP 503. Independent screenshot evidence and repeated retailer reliability remain unverified. See delivery-live-view.md.

Validation covers input/verdict rules, rejected runs, cancellation, concurrent reservations, timeouts, persisted quotas, restart recovery, API submission/polling and cross-origin protection. Browser fixtures cover temporary viewer links, terminal results, unsupported-retailer errors, tool visibility and mobile overflow.

See focused-product-plan.md for the complete contract, limits and acceptance criteria. Local work only; no deployment or push.

## Live validation outcome

The initial HTTP 403 was diagnosed as a beta restriction on custom max_steps. Removing custom agent configuration allowed a real run. The local 180-second deadline remains, but remote execution can continue after local abortion; a hard remote spending/step cap is not available through this account's tested configuration.

Live run 78568c3c-d6c6-4ed6-ae64-8e515773752d completed on 2026-10-30 in eight provider-reported steps. It exposed a streaming URL and delivery text but returned an unconfirmed PIN and a placeholder variant. Local evaluation correctly returned UNKNOWN with no contradiction verdict. The recovered report is stored in ignored artifacts/delivery-recovered.json, without the viewing URL. No positive PIN-specific delivery result has been demonstrated. Embedding, screenshot capture and repeated live reliability remain unverified.

The goal now explicitly requires applying the PIN and confirming its displayed value, and the evaluator rejects placeholder variants. Provider rejection, concurrent reservations, cancellation/late results, deadline and restart quota tests cover the lifecycle. Browser fixtures verify viewer links, terminal link removal, UNKNOWN evidence and mobile layout. They are fixture evidence, not an additional live retailer run.

## Successful live validation

Run 7de780f0-2b9f-44ac-96d6-cf2b354a13ff on 2026-10-30 checked https://www.amazon.in/dp/B0HP21TZYH for PIN 560064. Provider progress included opening the location control, entering and applying the PIN, and extracting the updated delivery information. The result confirmed PIN 560064 and the Ryzen 5 Pro 3500U / 16 GB RAM / 512 GB SSD configuration, with an explicit delivery message. Local evaluation returned DELIVERABLE. A live-view URL was received during execution; it was not stored in the report. The run took approximately 75 seconds locally. Evidence is in ignored artifacts/delivery-smoke.json.

This is one real observation, not a promise of universal support or future delivery. Result provenance now includes workflow version amazon-delivery-v1, source URL, completion time and a verdict explanation. Next phase: the three-PIN matrix, sharing the current concurrency and daily limits.

## Phase 2 — matrix

The Shopping delivery form accepts up to two additional comma-separated PINs. POST /api/delivery-matrices accepts {url, pincodes: [two or three distinct six-digit strings], variant?} and returns matrix_id plus job_ids. Poll /api/delivery-jobs and group by matrix_id. Each row retains its own result, run ID, observed variant, evidence and timestamps. Pending duplicate submissions reuse the existing matrix. Explicit later submissions start fresh checks.

All rows reserve the daily quota before any provider execution; an over-budget matrix is rejected as a whole with HTTP 429. Two jobs execute locally at once, with the remainder queued. Individual queued/running jobs support the existing cancel route. A failed row does not erase completed rows. Restart marks queued/running work interrupted and does not silently resume paid work. Cancellation aborts the local stream; it cannot guarantee remote cancellation. The matrix viewer links target a dedicated browser window/tab when supported by the browser, and evidence links scroll to the selected row's details.

Live matrix 566abe09-aaef-4f28-a920-d7550e84481e checked the same Amazon India listing for 560064, 110001 and 400001 on 2026-10-30. All three completed with agent-reported DELIVERABLE and confirmed requested PINs. The observed configurations and delivery messages are retained in ignored artifacts/delivery-matrix-smoke.json. Matching outcomes are displayed honestly; this is not independent verification or a future-delivery guarantee. Runs: 274c738d-9b06-45cd-9c9c-fd4f56f16abf, e52fc350-de57-4879-867d-792ec4225df1, 98cfa8d1-5ddd-4275-ba46-da736bed6f52.

Validation: 73 backend tests passed. Three focused browser tests cover matrix submission, mixed fixture outcomes, mobile overflow, viewer links, uncertain evidence and tool visibility. Build and formatting checks passed. The fixture with mixed outcomes is clearly test infrastructure, separate from the live all-deliverable results. Next: Phase 3 reviewed workflow publishing.

## Phase 3 — reviewed publishing

Completed, confirmed delivery results offer Review as API. Drafts contain a fixed URL, observed baseline, input/output schemas, permitted actions and limitations. Publication requires the exact draft digest and explicit UI acknowledgement. Published endpoints create fresh jobs with immutable contract provenance. Retired and draft versions cannot run. OpenAPI 3.1 documents invocation and polling. New versions come from later observed checks; this is bounded support for the existing delivery engine, not arbitrary workflow discovery. Next: opt-in monitoring and reviewed repair in Phase 4.
