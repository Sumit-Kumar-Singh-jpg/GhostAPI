# Website workflows — version 0.3

The Websites workspace enrolls public response data independently of the controlled supplier repair demo. It supports inspection, explicit field approval, repeated checking, change history, reviewable extraction-rule repair, and an authenticated JSON endpoint.

## Structure

| Module | Responsibility |
| --- | --- |
| `src/websites/public-read.ts` | Public HTTPS transport, DNS/address checks, pinned socket lookup, redirect validation, response size and time limits |
| `src/websites/inspect.ts` | HTML/product metadata/JSON inspection, source-backed field candidates, deterministic extraction |
| `src/websites/service.ts` | Independent storage, asynchronous jobs, contract versions, check scheduling, change history and repair lifecycle |
| `public/websites.js` | Enrollment, field review, monitoring controls, source evidence and repair review |
| `src/server.ts` | Authenticated API routing and lifecycle wiring |

Inspection reads up to 2 MB within a 20-second transport deadline and allows at most five redirect attempts. Every destination must resolve exclusively to public unicast addresses; the actual TLS connection uses the validated address. Credentials, private destinations and authentication query parameters are rejected. Remote page scripts are parsed as inert data and never executed. TinyFish Fetch additionally produces a public content preview for up to five same-origin linked pages. It uses the server-only TINYFISH_API_KEY and makes no Agent automation calls. Provider fetches have their own redirect and cache behavior; their results are untrusted, escaped report text and never executable extraction rules. Monitoring continues to use the pinned original-source transport. A provider failure is explicitly shown while original-source fields remain available. This preview is not a complete site crawl, browser network inspection, or source-code reconstruction.

## Contract lifecycle

An inspection records source URL, response digest, discovery time, candidate fields, and extraction rules. Approval accepts only fields from the current inspection hash. The approved origin and required fields become a versioned contract. Approval immediately schedules a fresh read; no extracted JSON is available until it passes.

Every check distinguishes value changes from extraction failures. Missing or ambiguous selectors withhold the current API result. If inspection discovers a supported replacement for each missing field, GhostAPI proposes a repair. The operator reviews old/new rules. Applying the proposal requires its base contract version to still match and a fresh source read to satisfy every required field. Failed verification preserves the active contract. History retains before/after values, source checks and repair events.

Verification here means approved source and required-field presence. It does not prove a product price is economically correct or that a replacement field has identical business meaning. The operator must review that meaning. The separate supplier demo has a stronger independent monetary oracle because it controls its fixture and acceptance cases.

## API

All routes require the same administrator session as the dashboard. Mutation requests require `X-GhostAPI-Client: dashboard` and a permitted Origin.

- `POST /api/websites` with `action: inspect` and `url`, optional `name` / `task`: returns 202 and an id.
- `action: approve` with id, inspection_hash, field keys and interval_minutes: approves a contract and queues a check.
- `action: check`: queues a fresh read; `pause` / `resume` control scheduling.
- `action: repair` with id and base version: queues fresh verification and conditional activation.
- `action: archive`: stops checks and hides the website; its stored record is retained.
- `GET /api/state`: includes website snapshots and scheduling/storage disclosures.
- `GET /api/websites/:id/data`: returns successful extracted values with timestamps and contract version; returns 409 when unavailable.
- `GET /api/export`: includes current website records alongside the supplier audit.

Long website operations run asynchronously and expose their phase through polling, so client disconnects do not require resubmitting a read. Jobs are serialized and per-website actions reject concurrent checks.

## Scheduling and storage

One in-process scheduler checks for due websites every 30 seconds. It does not backfill missed intervals. Up to ten active sites are supported. Paused or archived sites do not receive scheduled reads. Website state is saved atomically in `websites.json`; it survives normal local restarts independently of supplier state, but a free Render ephemeral filesystem does not provide durable deployment history.

Always-on monitoring, externally scheduled checks, durable cloud storage, authenticated target sites, browser request discovery, arbitrary CSS/JSON-path authoring, semantic AI repair and outbound notifications are future capabilities, not claims of this release.
