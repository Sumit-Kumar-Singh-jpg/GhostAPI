# GhostAPI implementation phases

Local development only. No six-hour deadline, demo overview, deployment, or Flask rewrite.
Reuse the TypeScript/Express app and existing public-page safeguards.

## 1. Shared workspace and request intake — implemented

Three simple tools: Website Builder, Shopping Assistant, Internship Checker.
Preserve website capture and monitoring. Save validated shopping and internship requests
locally, survive restarts, and deduplicate submissions. New requests explicitly remain
**Not checked yet**: no simulated evidence, automatic execution, or fraud verdicts.

Acceptance: navigation works on mobile and desktop; requests persist; invalid inputs are
rejected; existing builder and access-control tests pass.

## 2. Rendered website reproduction — implemented for supported public pages

Local Chrome capture now executes page scripts in a fresh isolated context. GET responses are
supplied through the DNS-pinned public transport; writes, frames, sockets and service workers
are blocked. Bounded scrolling, current image sources, computed styles and dynamic stylesheets
freeze a rendered state. Saved source/preview screenshots use the same 1280 × 800 viewport.
Capture failures fall back explicitly to raw HTML. Browser jobs are serialized and duplicate
requests share the active capture. No remote browser charges are incurred by this capture path.

Verified: a scripted/lazy fixture reproduces the source viewport byte-for-byte and blocks a
write request. This is fixture evidence, not a universal fidelity score. Shadow DOM, canvas,
CSS imports and embedded media remain limitations; multi-page capture is future work. Static SVG
icons are preserved, while executable SVG and foreign content are stripped.

Capture a rendered page, its screenshot, loaded styles, images and fonts. Handle lazy-loaded
content with bounded scrolling. Reproduce the captured state inside the isolated preview;
show missing assets and unsupported interactions. Compare against the source screenshot at
the same viewport. Start with supported public pages, then add explicitly selected pages.
Do not promise an exact copy of arbitrary sites or reproduce login/payment workflows.

Acceptance: styled and JavaScript-rendered fixtures retain their visible content and layout;
original scripts cannot execute in the preview; capture failures are visible and recoverable.

## 3. Interaction capture and verified APIs — implemented for public GET pagination

Rendered previews now identify visible Next / Load more / Show more controls and outline them
in blue. The separate source-API panel runs a selected control in an isolated browser, records
post-action JSON response events, and submits sanitized response metadata to REA. Only same-origin
GET endpoints with a small supported parameter set can become replay candidates. Raw response
bodies, cookies and headers are not persisted. Secret-bearing parameters are rejected.

Exact scalar matches between newly visible leaf text and JSON paths form a field mapping.
A fresh HTTP GET must reproduce those fields and their types, and REA evidence must succeed,
before replay is enabled. Ambiguous endpoint matches are withheld. Each replay checks the saved
mapping again; changed values or response structure mark it stale. Reports survive restarts.
This verifies selected fields for one fixed URL, not a complete reusable client or all parameters.

Limits: pagination only, no authenticated sessions, POST/GraphQL, parameter editing, arbitrary
clicks or cross-origin source APIs. At most three candidate responses are checked per run.
Response timing provides association, not proof of causality. A missing candidate is reported
honestly; ordinary server-rendered navigation need not expose a JSON endpoint.

Capture real browser network traffic for selected read-only interactions. Redact credentials
before persistence. Feed the capture into REA, correlate controls with observed requests,
and verify a candidate endpoint against browser-visible results before enabling replay.
Keep generated extraction endpoints distinct from observed source endpoints. Current REA
support analyzes metadata from our HTTP capture, not browser interaction traffic.

Acceptance: a supported fixture interaction produces an evidence-linked request and validated
replay; a changed or mismatching response is rejected; no invented source APIs.

## 4. Shopping assistant — initial search and listing checks implemented

TinyFish searches for candidates and reads up to four pages. A guarded original-page read
supplements cleaned HTML with structured metadata. Source cards show prices, currencies,
model/variant details, stock claims, seller and supported return-policy fields when present.
Each fact includes its source selector or metadata path. Comparisons require matching reported
GTINs and currency, with no conflicting variant details or conflicting observed prices.

Checks persist locally, deduplicate active submissions, reuse explicitly labeled results for
15 minutes, support Run fresh, and discard late results after cancellation. Two checks may run
at once. Interrupted jobs require an explicit retry. Monitoring setup hands the selected URL
to the existing review-and-approve flow. Shipping totals, pincode-specific delivery checks,
independent seller verification and authenticity checks remain future work; unknowns are shown.

Implement product search and listing checks using TinyFish. Compare exact models/variants,
currency, price, delivery, seller and return-policy evidence from supported stores. Preserve
source URLs and observation times; distinguish missing evidence from negative evidence.
Add user-requested monitoring after one-shot checks work. No authenticity guarantee.

First slice: one listing -> sourced product facts and uncertainties. Then product search,
cross-store comparisons and delivery checks. Use typed outputs, local validation, bounded
provider concurrency, duplicate-run prevention, cancellation and explicit fresh/cached states.

Acceptance: fixture cases cover variants, unavailable products, blocked pages and partial
results; supported live sources are checked separately with measured costs and durations.

## 5. Internship checker — bounded evidence review implemented

The checker accepts a public URL or description and an optional user-supplied company reference
website. It reads the listing/reference, follows at most two same-host careers links, and looks
for a separate reference page linking to the exact opportunity. Search leads are never promoted
to official company sources. Recruiter/application domain mismatches are questions, not fraud proof.

Deterministic text screening flags explicit payment and credential requests and ignores common
negated safety advice. Findings include source links or submitted-text excerpts. Warning signs
take precedence over supporting links. Unavailable sources remain uncertain. Descriptions without
a reference URL receive local screening only; private description text is not sent to search.

Shared research jobs provide caching, fresh checks, cancellation and restart recovery. Independent
company identity verification, comprehensive fraud detection and multilingual analysis are not
implemented; the interface states these limits.

Accept a URL or description. Corroborate company identity, careers listings, application
domains and recruiter claims using public evidence. Explain payment requests, domain
inconsistencies and sensitive-information requests. Missing careers listings alone do not
prove fraud. Evidence and contradictions determine findings, not a made-up confidence score.

Use Supporting evidence found / Needs verification / Strong warning signs, with per-claim
sources, timestamps and unresolved questions. No automatic applications or recruiter contact.

Acceptance: legitimate, suspicious and ambiguous fixtures produce explainable results;
unavailable sources never become unsupported safe/fraud verdicts.

## 6. Monitoring, resilience and release readiness — local milestone implemented

Completed shopping/internship results and verified source APIs support opt-in daily checks.
The Scheduled checks panel provides manual checks, pause/resume, removal and before/after history.
Failed checks preserve previous observations. Interrupted checks become explicit errors and
restart schedules wait a full interval instead of replaying missed work. Research jobs enforce
a persisted rolling limit of 30 starts per tool per 24 hours; this is not a monetary budget.
There are at most 10 scheduled checks with 20 history entries each. Visual files save atomically.

Validation covers restart recovery, limits, cancellation, authenticated routes and the browser
journey, including changes, pause, reload and mobile layout. See [local readiness](local-readiness.md)
for the tested scope and remaining limitations. Hosting and external notifications remain separate.

Persist jobs and results, recover interrupted work, enforce budgets and test cancellation.
Add opt-in monitoring and explain value changes or broken API connections. A fallback browser
run is not a repaired API: validate any regenerated client before replacing it.
Test the full local journey, accessibility, hostile page content and preview isolation.
Hosting is a separate user decision after the local product is ready.

## Evidence model for phases 2–6

Each claim needs its source URL, observation time, supporting excerpt or captured field,
collection method and limitations. Jobs need explicit running, completed, partial, failed
and cancelled states. Treat source-page instructions as untrusted content. Store secrets
only server-side; redact them from captures and UI. “Completed” never means “verified.”
