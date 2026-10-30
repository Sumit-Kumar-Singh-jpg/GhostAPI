# GhostAPI — Revised Focused Product Plan

## Product

GhostAPI turns supported interactive website workflows into callable, inspectable APIs using TinyFish agents. Every result includes observations, evidence and explicit uncertainty.

First use case: delivery availability for Indian laptop listings. Enter a supported retailer product URL, a six-digit PIN code and an optional variant. Watch the check progress, then inspect the delivery result and its evidence.

## Scope and implementation baseline

Continue the existing TypeScript/Express repository. Reuse authentication, saved requests, asynchronous job patterns, Shopping UI and local persistence. Current shopping extraction and GET-pagination discovery do not implement PIN-specific delivery checks; this is new work.

Select one retailer and its supported laptop product-page format after a live feasibility check. Record the retailer, allowed domains, supported variant controls and known blockers before widening support. If a Flask prototype is available, inspect and port useful logic; its existence is not a dependency.

Preserve existing tools but defer internship expansion, scholarship features, visual-cloning improvements, arbitrary-site workflows and checkout actions. Develop locally; publishing an endpoint in this plan means exposing it in the local authenticated app. Public hosting requires a separate decision.

## Inputs and verdict rules

- Required: supported HTTPS product URL and PIN matching six digits, starting with 1–9. Syntax validation does not establish that a PIN exists.
- Optional: requested product variant. Confirm the selected variant from the page; when omitted, report the observed default.
- DELIVERABLE: explicit delivery confirmation applies to the requested PIN and confirmed variant.
- NOT_DELIVERABLE: explicit delivery rejection applies to that same PIN and variant.
- UNKNOWN: missing or ambiguous evidence, blocked access, unconfirmed PIN/variant, unsupported page, timeout or suspected workflow drift.

Never infer delivery from a generic “in stock” label. Successful agent execution alone is not proof. A contradiction flag is true only when an explicit listing availability claim conflicts with an explicit delivery rejection for the same variant. Use null when there is insufficient evidence. Contradictions are not fraud verdicts.

## Evidence and result contract

Persist requested and observed PIN, requested and observed variant, source URL, observation timestamp, workflow version, TinyFish run identifier, relevant page excerpts and available screenshots. Include observed price and currency only when supported by the page. Preserve the distinction between agent-reported observations and independently validated fields.

Every verdict must reference its supporting evidence. A screenshot is supplementary; missing screenshots must be disclosed. Do not manufacture run IDs, quotes, screenshots or live data. Define screenshot availability and retention after verifying provider capabilities.

Example interface:

POST /api/check-delivery
Input: { "url": "https://supported-retailer.example/laptop", "pincode": "560064", "variant": "optional" }
Response: HTTP 202 with job_id and status_url.

GET /api/delivery-jobs/:id
Returns job state, progress, optional temporary live-view information, and final result.

Job states: queued, running, completed, failed, cancelled, interrupted.
Result verdicts: DELIVERABLE, NOT_DELIVERABLE, UNKNOWN.
Reason codes distinguish blocked access, timeout, unsupported page, variant ambiguity, insufficient evidence and suspected workflow drift. Validation errors return HTTP 400 before a provider run; capacity/budget rejection returns HTTP 429. A completed job can legitimately have an UNKNOWN verdict.

## Live TinyFish execution window

During an active check, show a browser-view panel beside progress and results. The intended experience lets users watch TinyFish open the listing, select the variant, enter the PIN and inspect the delivery message.

Before promising this feature, verify the available TinyFish API/SDK support for a live viewing URL, its lifecycle, embedding restrictions and access controls. This is a capability gate, not an assumed API feature.

- If an embeddable provider live view is supported, display it within GhostAPI with a visible Live label.
- If viewing is supported only externally, provide an explicit Open live browser action in a separate window/tab.
- Otherwise show actual provider progress events and available timestamped screenshots, labeled Progress or Captured evidence, never Live video.
- Do not embed the retailer homepage as a substitute for the agent session or simulate browser actions/progress.
- Show connecting, running, disconnected, ended and unavailable states. Viewer failure must not erase or falsely fail the underlying check.
- Keep the final result, evidence and execution timeline after the temporary viewer expires. Do not promise a replay unless recording support is verified.
- Restrict viewing to the authenticated job owner. Keep API keys server-side; treat temporary viewing links as sensitive and exclude them from logs and durable reports.

For the PIN matrix, select one active run to view at a time; each row retains its own status and evidence.

## Workflow-to-API lifecycle

1. Discover a supported workflow through bounded TinyFish exploration.
2. Save a proposed specification: allowed domains, input schema, permitted actions, variant/PIN confirmation rules, expected observations, evidence requirements and output schema.
3. Review and version the specification. Discovery does not automatically publish executable workflows.
4. Invoke the approved workflow with a fresh TinyFish run per accepted request.
5. Validate the returned evidence and expose results through authenticated polling endpoints.
6. Classify failures. Repeated structural failures may indicate drift; ordinary network failures or blocked pages do not automatically prove drift.
7. Propose a new workflow version, retest supported cases and obtain review before replacing the active version. Retain the previous version for traceability.

This API executes a browser workflow; it does not claim to reproduce a retailer's private backend API. Treat source-page instructions as untrusted content. Permit delivery-related controls only; exclude login, purchases, cart submission and payment operations.

## Execution limits and recovery

Initial configurable limits: two concurrent delivery runs, three PINs per matrix, 30 delivery starts per rolling 24 hours, a 180-second local deadline per run, and no automatic paid retries. Confirm the deadline against initial measured runs and document any adjustment.

Persist reservations before starting provider work. A three-PIN matrix consumes three starts and uses an isolated session per PIN. Deduplicate double submissions with an idempotency key; an explicitly fresh check creates new work. Show cached observations only with their original timestamp and a Cached label.

Expose cancellation. Request provider cancellation when supported, discard late results after local cancellation, and disclose when remote work may continue. Recover interrupted jobs as interrupted; never silently rerun paid work after restart. Run-count limits are not monetary guarantees. Record provider duration and usage/cost when available; otherwise show cost as unknown.

## Build stages and acceptance

### 1 — One retailer, one PIN, observable execution

Verify live-view capabilities and select a supported retailer. Add URL/PIN/variant inputs to Shopping, an asynchronous delivery endpoint, live-view panel or honest fallback, evidence validation and persisted results.

Done: a real supported listing produces a traceable observation for one PIN; fixtures cover positive/negative/unknown results, variant mismatch, missing PIN confirmation, blocked pages, timeout, cancellation and viewer failure. Measure live duration and available usage. Browser tests cover submission, progress, result viewing and reload.

### 2 — Multi-PIN availability matrix

Compare one laptop/variant across up to three PINs. Show independent statuses, timestamps, evidence and contradiction findings, with one selectable execution viewer. Partial completion remains visible when another run fails.

Done: run three real PIN checks and display the actual outcomes, even when they all match. Never require fabricated differences for the presentation.

### 3 — Reviewed workflow-to-API generation

Discover, review, version and publish one supported workflow contract. Provide its documented authenticated endpoint and example request. Validate inputs and evidence against the approved version.

Done: invoking the published workflow starts a real fresh run and yields inspectable output. Unsupported inputs are rejected before execution; unapproved workflows cannot run.

### 4 — Monitoring, drift and controlled repair

Add opt-in repeated checks within shared delivery limits, compare relevant observations, and distinguish ordinary failures from suspected drift. Review and retest replacement versions before activation. Existing local-server scheduling limitations remain explicit.

Done: changed observations have before/after evidence; broken workflows return UNKNOWN/error without unsupported data; reviewed repair passes relevant regression cases before replacing the active version.

## Presentation success criteria

- Demonstrate a real supported listing across three PIN codes using whatever outcomes are actually observed.
- Show the callable endpoint, workflow version, run identity, timestamp and supporting evidence.
- Show TinyFish execution live only when the provider supports it; otherwise clearly identify the fallback.
- Include one honest failure/uncertainty example. Label fixture demonstrations as fixtures.
- Explain the boundary: website observations are time-specific and do not guarantee future delivery or product authenticity.

Jury takeaway: “GhostAPI turns user-visible website actions into inspectable APIs with evidence and explicit uncertainty.”
