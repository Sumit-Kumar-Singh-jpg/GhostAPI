# GhostAPI

An evidence-based repair and verification sandbox for read-only website workflows.

The local MVP is implemented: a supplier portal changes from inclusive to exclusive pricing; GhostAPI withholds the old workflow's result, inspects captured evidence with REA, proposes a bounded configuration change, replays independent cases, and publishes only after validation. The dashboard exposes the observations, failed checks, version diff, source hashes, and rollback outcome.

**Execution modes are explicit.** The working default reads real local HTTP responses and uses a labeled rules fallback. It is not a TinyFish browser demonstration or an autonomous LLM repair claim. REA is actually invoked against a sanitized supplied HAR; its normalized findings feed the planner. An optional OpenAI structured-output planner is implemented but requires a model, key, and configured charge bound. Remote TinyFish runs remain blocked until the required pre-action execution restriction is implemented and demonstrated.

## Run locally

Requires Node.js 24.11 or newer in the Node 24 line (the pinned REA package also supports its documented Node 22/26 versions). Chrome is used by browser tests.

```powershell
npm ci
npm start
```

Open [the dashboard](http://127.0.0.1:3000) and [the read-only supplier portal](http://127.0.0.1:3001).

Click **Run local demo**. It archives the previous sandbox state and executes:

1. wf1 baseline on r1: MOTOR-01, quantity 1, ₹1,180 inclusive.
2. Operator-controlled switch to r2: ₹1,000 before tax.
3. wf1 replay withheld for changed basis/missing fields.
4. Real local HTTP response captured as HAR; pinned REA CLI inspects the sanitized artifact.
5. Labeled rules fallback proposes wf2 from observed fields and the fixed patch catalog.
6. MOTOR-01 × 1, SENSOR-01 × 3, and allowed-but-unavailable UNAVAILABLE-01 × 1 replay against independent expectations.
7. Provisional activation, final replay, and verified ₹1,180 publication.

You can also advance manually with the operator controls. **Restore previous active version** on r2 returns to wf1 and remains Degraded, because restoring a saved config does not restore compatibility. Switch to r1 and replay wf1 to demonstrate its compatible behavior. **Test bad patch** demonstrates rejection before execution.

All prices and tax rates are synthetic. The fixture has no checkout, user accounts, or write handlers. Its release control exists only in the loopback dashboard, not in the portal.

## Optional configuration

Copy `.env.example` to `.env` and set values locally; do not put keys in frontend code or share the file. The app does not make an LLM request unless the operator explicitly chooses the configured LLM planner.

| Setting | Meaning |
| --- | --- |
| `PORT`, `PORTAL_PORT` | Defaults 3000 and 3001 |
| `DATA_DIR` | Private JSON state, archived runs, sanitized HAR and REA receipts; ignored by Git |
| `CYCLE_BUDGET_USD` | Reservation ceiling; default 1 USD; not a measured cycle price |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Explicit planner credentials and model; no model is silently selected |
| `PLANNER_MAX_COST_USD` | Verified conservative upper bound per planner call; required before an LLM request |
| `TINYFISH_API_KEY`, `PUBLIC_PORTAL_ORIGIN` | Provider preparation only; setting them does not bypass the execution-boundary blocker |

The optional planner uses the [official Responses structured-output API](https://developers.openai.com/api/docs/guides/structured-outputs). Provider output still passes the local immutable-policy validator. No remote planner call has been validated by the keyless test suite. Charge reservations are conservative configured bounds, not provider-reported actual billing; do not claim a hard billing guarantee without a verified upper bound.

### Operator HAR import

Start a baseline/evidence cycle. In the separate local browser, request the portal's quote JSON for one input, then export a HAR with response content. Use **Import operator HAR**. Only fresh same-origin GET quote JSON for the current release/input is retained. Cookies, headers, unrelated entries, and unknown body fields are removed before REA ingestion. A stale capture, missing body, or mismatched release is rejected. The convenience **Inspect** button creates a real HTTP HAR itself; the UI labels it as local HTTP capture, not operator browser export.

### Separate supplier deployment

```powershell
npm run portal
```

This starts only the read-only fixture. `SITE_RELEASE=r1` or `r2` selects the release at process start. `PORTAL_HOST=0.0.0.0` binds that standalone portal for an explicitly configured hosting environment. Keep the dashboard loopback-only. Hosting and public reachability have not been verified here. Public deployment does not itself satisfy the TinyFish execution-boundary gate.

## Verify

```powershell
npm run check
npm run test:e2e
npm run build
npm run format:check
npm audit
```

`npm run check` includes TypeScript and meaningful domain/integration tests. Integration tests start real isolated HTTP servers, use independent expected quotation values, and execute the pinned REA CLI on actual captured responses. They exercise bad-tax rejection, input/policy restrictions, transient retry, rollback compatibility, deadline expiry after provisional activation, persistence recovery, and API isolation. Browser tests use installed Google Chrome for the complete dashboard flow and a 390px mobile viewport. To use bundled Chromium instead, install it with Playwright and remove `channel: 'chrome'` in the Playwright config.

Desktop/mobile screenshots are generated under ignored `artifacts/`; failure traces are under ignored `test-results/`. Neither location should contain real credentials or customer data.

## Implementation boundaries

- **No remote execution claim:** the installed TinyFish Agent SDK does not establish a pre-action origin/write restriction. The server returns an explicit blocker before any remote run. There is no `safe=true` configuration shortcut. See [the TinyFish integration](src/integrations/tinyfish.ts).
- **No contribution claim:** controlled LLM/TinyFish ablation has not run. Real REA parsing and a successful rules-fallback demonstration do not establish causal AI improvement.
- **No production approval claim:** this is a loopback developer sandbox, with no production authentication, multi-user access, or arbitrary-origin enrollment.
- **No PRD compliance certificate:** the authoritative `trace_lint.py` and its schema references remain unavailable. Runtime tests do not replace that document validator.

See [implementation decisions](docs/implementation.md) for module boundaries, requirement coverage, the two revision-4 clarifications, and remaining integration work.

## Dependency note

`rea-agents` is pinned to 6.7.0. Its Zod dependency is overridden to 4.6.7 to address [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Real REA capture tests verify compatibility with that override. `package-lock.json` pins the resolved dependency tree; use `npm ci` for reproducible installs.
