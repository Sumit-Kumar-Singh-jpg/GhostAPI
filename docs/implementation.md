# GhostAPI implementation decisions

Baseline: GhostAPI PRD revision 4, reviewed in the accompanying project conversation. This file records implementation decisions; it does not amend the original Downloads PRD or establish formal approval.

## Modules and trust boundaries

| Module | Responsibility | Excluded information or authority |
| --- | --- | --- |
| `src/portal/` | Read-only supplier fixture and independent supplier arithmetic | No dashboard mutations, secrets, planner or validator imports |
| `src/integrations/local.ts` | Bounded GET-only HTTP reading and fixed projection | No fixture prices, oracle imports, generated code, arbitrary origins or redirects |
| `src/integrations/evidence.ts` | Sanitize HAR, invoke REA, validate returned artifact digest, extract normalized field/path findings | No arbitrary executable or shell arguments, no raw credentials in planner context |
| `src/integrations/planner.ts` | Catalog-constrained rules fallback or explicit OpenAI call | No expected answers or supplier fixture import; no price constants in patch |
| `src/domain/` | Input, patch, money, evidence, source and budget checks | No mutable/generated validator policy |
| `src/oracle.ts` | Independent fixed expectations used only by acceptance/promotion gate | Not imported into executor or planner |
| `src/service.ts` | State transitions, retries, cycle checks, shadow tests, publication and rollback | Cannot treat completed extraction as verified business success |
| `src/store.ts` | Atomic JSON persistence and interrupted-cycle recovery | Never resume unfinished publication on process restart |
| `src/server.ts` | Loopback dashboard control API | Not exposed with the standalone public portal |
| `public/` | Timeline, configuration diff, quote, version and evidence views | No server-side credentials |

The local HTTP executor ignores page instructions and uses fixed typed data extraction. Its pre-request origin/path policy is testable and enforced in code. This does not establish the same restriction for a managed remote browser; TinyFish therefore remains capability-blocked.

## Revision 4 clarifications

**G08 — timeout during final replay:** activation remains provisional. Publication is removed before final replay. If replay fails, expires or becomes stale, restore the previous pointer locally and quarantine the candidate. When time and call capacity remain in the same release/cycle, replay the restored workflow and mark Healthy only if validation succeeds. After expiry, remain Degraded and do not start an out-of-budget replay; a later explicitly budgeted recovery operation must establish compatibility. On restart, an unfinished activation is compared with the committed activation history; its pointer is restored and its candidate quarantined.

**G09 — ablation completion versus contribution:** runtime capability state reports `not_run`; it does not turn an inconclusive comparison into a pass. A future full evaluator must track protocol completion separately from recovery and contribution, including all four with/without success combinations. The current rules demonstration cannot close that gate.

**Cycle release switch:** the explicit r1→r2 operator break can retain the original demo deadline. It updates the cycle's current release and workflow generation, clears publication, and invalidates candidate proof. Earlier r1 runs remain historical baseline evidence and cannot satisfy current-release shadow verification. Release changes while candidate work exists quarantine that candidate.

**Evidence acquisition:** a local HTTP HAR is a real response capture, but not browser/CDP evidence. Operator browser HAR upload is supported separately. Both are sanitized before inspection. When REA succeeds, planner field/path findings come from its actual normalized response records and verified artifact digest. When REA fails, local findings remain visibly local; no REA-assisted result is claimed.

## Requirement coverage

| PRD requirements | Implemented scope / evidence |
| --- | --- |
| FR-01, FR-07, FR-17 | Strict Ajv input and bounded patch schemas; mandatory-policy and wrong-tax tests |
| FR-02 | Official SDK integration and fail-closed capability gate; actual remote run pending |
| FR-03–05, FR-21 | Persisted contracts, inclusive/exclusive validation, observed/derived totals and local drift replay |
| FR-06 | Real REA supplied-HAR inspection; passive browser/CDP acquisition not implemented |
| FR-08–10 | Positive/unavailable acceptance suite, bad-patch rejection, compatible/incompatible rollback |
| FR-11–12 | Responsive dashboard and JSON audit download |
| FR-13 | Deferred as specified |
| FR-14–16 | One transient retry, blocked access stop, unknown-evidence abstention |
| FR-18 | GET-only local boundary and isolation tests; remote managed-browser boundary pending |
| FR-19, NFR-01–05 | Persisted reservations, bounded requests, deadline/staleness rejection, provisional activation cleanup, actual run labels |
| FR-20 | Explicit `not_run` status; controlled remote/LLM ablation pending |
| FR-22 | Source PRD retains draft metadata; authoritative document validator unavailable |

## Remaining integration work

1. Establish a supported pre-action restriction for TinyFish managed execution; a prompt or operator assertion is insufficient. Implement that code boundary and its hostile-page tests before enabling remote calls.
2. Deploy only the supplier portal to an approved public origin and verify reachability from the provider browser.
3. Configure an explicit LLM model and verified per-call charge bound, then run real refusal/schema/patch tests. Keyless tests do not establish model behavior or actual cost.
4. Implement the controlled contribution evaluator; preserve both planner contexts and equal verification budgets. Record completed, failed, or inconclusive evaluation separately from assisted/sufficient/failed recovery.
5. Run the complete provider-backed acceptance suite and measure total latency and charges. Obtain event-rule confirmation separately.

No production deployment, credential changes, external messages, or paid provider runs are performed by local setup or tests.
