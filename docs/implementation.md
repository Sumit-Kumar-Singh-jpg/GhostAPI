# GhostAPI implementation decisions

The source specification is GhostAPI PRD revision 4. This document describes the implementation; it does not amend or formally approve that PRD.

## Boundaries

The supplier fixture has independent arithmetic and no checkout or write handlers. The local executor performs allowlisted GET requests. The TinyFish Browser executor installs context routing before navigation, blocks scripts/service workers/WebSockets, and forwards only enrolled reads through the same local boundary. This makes a public supplier deployment unnecessary. Autonomous TinyFish Agent browsing remains disabled; the AI planner uses a separate about:blank reasoning task.

Evidence ingestion sanitizes supplied HARs, invokes pinned REA, verifies its output artifact digest, and extracts field/path findings. REA is a supplied-capture inspector here, not a passive CDP recorder. Planner output is a schema-constrained configuration change over fixed libraries. Neither planner nor executor imports the independent acceptance oracle.

The domain layer enforces immutable safety policy, input identity, origin, freshness, price basis, integer money arithmetic, source evidence and independent expected values. Service orchestration handles reservations, deadlines, retries, shadow verification, provisional activation, final replay and rollback. Atomic persisted state recovers interrupted activation without publishing an unverified result.

## Failure behavior

A failed or expired final replay restores the previous pointer and quarantines the candidate. It replays the restored workflow only while time and call capacity remain; otherwise it stays Degraded with publication withheld. Restoring a version does not establish compatibility with the current supplier release.

Release switches invalidate publication and candidate proof. Previous-release runs remain history and cannot satisfy current-release verification. Unresolved remote cleanup blocks new paid runs. Unknown creation markers require investigation rather than blind retries.

## Controlled comparison

With-REA and without-REA arms use independent planner calls, the same observations and patch catalog, and equal offered budgets. Each valid patch gets two quotation cases and one unavailable SKU. Neither candidate is activated. Reports distinguish all four recovery combinations, interruption, and rules-only scope. Passing both arms means recovery without REA was sufficient. A with-only success also requires a valid REA evidence reference before any assistance label.

A live TinyFish AI comparison completed alongside guarded remote browser replays: both arms passed. This establishes that the protocol ran, not that REA improved repair. TinyFish manages the underlying model and exposes no model version, which limits reproducibility. OpenAI is implemented but has not been live-tested without configured credentials/model.

## Deployment

The dashboard can bind publicly only with production authentication and a canonical HTTPS origin. On Render the origin falls back to RENDER_EXTERNAL_URL. The supplier stays on loopback. The deployment uses one instance and ephemeral JSON/evidence storage at `/app/data` on the user-selected free plan; do not scale it across independent processes. State and audit history reset on restart/redeploy. Administrator sessions are in memory and restart requires signing in again.

The Render Blueprint and Docker/Compose packaging are implemented. Actual public hosting must be verified separately after account configuration and deployment; configuration files alone are not proof of a live service.

## Remaining limits

Version 0.3 adds a separate public-response website enrollment and monitoring flow, documented in `website-workflows.md`. Arbitrary browser workflows, autonomous Agent navigation, multi-user authorization, managed shared storage, formal PRD trace-lint certification and event-rule approval remain outside the verified implementation. Provider reservations are not billing receipts. Synthetic demo arithmetic is not financial guidance.
