# GhostAPI

**Reviewed delivery APIs:** complete a PIN-specific check in Shopping, choose **Review as API**,
inspect the contract and publish a local endpoint. Each invocation starts a fresh TinyFish check.
See [delivery workflow publishing](docs/delivery-workflows.md).

Published delivery results support **Monitor daily**, change history and workflow health.
Replacement drafts require fresh regression checks and explicit review before activation.
See [delivery monitoring and recovery](docs/delivery-monitoring.md).

**Phase 6 adds local scheduled checks:** choose **Monitor daily** on a completed shopping or
internship result, or a verified source API. Open **Scheduled checks** to check now, pause,
resume, remove, and inspect changes. Checks run only while the local server is awake.
See [local readiness and limits](docs/local-readiness.md).

**Shopping Assistant is now active:** search for products or check a listing, inspect sourced facts
and uncertainties, compare compatible reported identifiers/currencies, and hand a listing to the
monitoring setup. Saved results, explicit cache reuse, fresh checks and cancellation are supported.
See [shopping scope](docs/shopping.md).

**Internship Checker is now active:** review public listings or descriptions, compare an optional
company reference website, and inspect sourced warning signs and unresolved questions. It does not
certify company identity or declare opportunities safe/fraudulent. See [internship scope](docs/internships.md).

Phase 3 adds **Discover source APIs** beneath a website preview: select a captured pagination
control, inspect browser-observed JSON requests, and test a source endpoint only after REA evidence
and a fresh response match newly visible fields. Changed or ambiguous mappings are withheld.
See [source API discovery](docs/source-api-discovery.md) for supported sites, limits and routes.

The local workspace has **Website Builder**, **Shopping Assistant**, and **Internship Checker**. Validated requests are saved in `DATA_DIR/requests.json`; shopping results are saved separately in `DATA_DIR/shopping.json`. Identical submissions are deduplicated and saved requests survive restarts. See [the phased build plan](docs/build-phases.md) for implementation order and acceptance criteria.

Current local work: a **visual website-to-API builder**. Paste a public URL, capture its rendered state in isolated local Chrome, compare source and preview screenshots, click highlighted fields, and test approved extraction endpoints. The preview is frozen and does not execute source scripts. Failed browser captures show a labeled raw-HTML fallback. Run `npm start` and open http://127.0.0.1:3000. See [the local builder guide](docs/visual-builder.md) for scope and limitations. No deployment is part of this development milestone.

GhostAPI turns public website data into a reviewed extraction contract, monitors it for changes, and verifies replacement rules when extraction breaks. The default Websites workspace supports public HTML, structured product metadata, and top-level JSON. The interface focuses on one URL-to-data flow; supplier fixtures remain internal test infrastructure.

## Website workflows

1. Paste a public HTTPS URL. Optional details can name the workflow.
2. Read a TinyFish site report covering up to five linked public pages. Inspect actual response data. Review discovered fields, sample values, source rules and the response digest.
3. Select required fields and approve a contract. A fresh check must pass before the JSON endpoint returns data.
4. Monitor on a 15-minute, hourly, six-hour or daily interval; check immediately, pause or resume from the card.
5. When values change, inspect the before/after history. When a required extraction rule breaks, data is withheld. If a supported alternate rule exists, review it and apply it only after another fresh source read passes.

Use a public detail-page URL for precise fields. Each website has an authenticated `GET /api/websites/:id/data` endpoint. It returns the source URL, observation time, contract version and extracted values; it returns HTTP 409 when the current extraction is unavailable. Sign-in is required just like the dashboard. **Archive website** stops its checks and removes its card while retaining its record in local storage.

The task description records intent; the selected fields define the executable contract. This inspector does not run JavaScript, authenticate to target sites, capture browser network traffic, or infer arbitrary workflows from natural language. Product extraction supports common metadata and unambiguous selectors; JSON inspection supports top-level primitive fields. General website repairs use supported extraction alternatives and explicit operator review, not the demo's AI planner or its independent money oracle.

Checks run while the Node service is awake. Sleeping pauses checks; missed intervals are not backfilled. On the selected free Render plan, restarts and deployments reset website state and history. The dashboard states these limits. This release does not provision an always-on external scheduler.

Website records live in `DATA_DIR/websites.json`, separately from the supplier demo. Resetting the demo does not reset website records. See [website architecture](docs/website-workflows.md).

## Run

Requires Node.js 24 and npm. Run `npm ci`, then `npm start`, and open http://127.0.0.1:3000. Website Builder is the default screen; switch tools using the three buttons at the top. Internal supplier fixtures run separately on loopback port 3001 for automated tests and are not part of the main user flow.

## Execution and repair modes

- **Local HTTP** is the default, with real GET responses and a labeled rules fallback. No provider charges are incurred by this mode with AI disabled.
- **TinyFish Browser** creates actual remote Chrome sessions, controlled through Playwright CDP. A fresh context blocks scripts, service workers, WebSockets, writes, off-origin requests, and unenrolled routes before forwarding approved reads through a local bridge. It reads the real supplier DOM. This is controlled remote browser execution; autonomous Agent website navigation remains unavailable.
- **AI repair planner** uses TinyFish Agent as an isolated JSON reasoning task on about:blank, or OpenAI when its key, explicit model and charge bound are configured. It receives typed observations and a fixed patch catalog, never the independent acceptance oracle. All generated patches pass strict local policy validation.
- **REA comparison** creates separate with/without-REA planner contexts with equal offered budgets and three independent replay cases per arm. It does not activate either candidate. Protocol completion, recovery success, and evidence contribution are reported separately.

Set keys in an ignored `.env` or hosting secrets, never in frontend code. Enable AI explicitly in the dashboard. The UI exposes executor identities, planner receipts, source evidence, failed checks, workflow differences, audit export and compatible/incompatible rollback.

## Budget and provider lifecycle

Reservations are conservative upper bounds, not measured bills. TinyFish Browser reads the wallet meter before execution. TinyFish AI reserves the default 150-step ceiling because this account does not support custom step limits; at the verified $0.016/step rate this reserves $2.40 per proposal. Select a $3 cycle cap for one AI proposal or $6 for paired comparison. Actual usage can be lower. Rates are read from the provider rather than assumed.

Remote browser sessions are explicitly deleted. Queued AI tasks are tracked until terminal and cancelled on interruption. Unresolved provider cleanup blocks further paid execution; use the reconciliation control. Do not blindly repeat a run after an uncertain creation response.

## Configuration

See `.env.example`. Important settings:

| Variable | Purpose |
| --- | --- |
| PORT / PORTAL_PORT | Dashboard and loopback supplier ports; defaults 3000 / 3001 |
| DATA_DIR | Durable JSON state, evidence, archives and REA artifacts |
| TINYFISH_API_KEY | Remote browser and AI planner access |
| OPENAI_API_KEY / OPENAI_MODEL / PLANNER_MAX_COST_USD | Optional explicit OpenAI planner and per-call reservation |
| ADMIN_PASSWORD | Required in production, at least 16 characters |
| PUBLIC_ORIGIN | Canonical HTTPS deployment origin; Render automatically supplies RENDER_EXTERNAL_URL as fallback |
| HOST | Loopback locally; 0.0.0.0 permitted only with production authentication |
| TRUST_PROXY | Set 1 behind the Render proxy |

Production uses administrator sign-in, an HttpOnly Secure SameSite cookie, sign-out revocation, sign-in throttling, host/origin checks and security headers. Sessions expire after eight hours and are cleared on restart. This is a single-operator demonstration, not a multi-tenant service.

## Render deployment

`render.yaml` defines one Docker web service in Virginia (the existing account region), ephemeral state at `/app/data`, `/healthz`, and automatic deployment on pushes to main. The selected free plan has no persistent disk: state and audit history reset on restart or deployment, and idle services can cold start. TinyFish provider calls are billed separately.

Push the configuration to the private GitHub repository, open the Render Blueprint creation flow, grant repository access if prompted, and supply ADMIN_PASSWORD and TINYFISH_API_KEY as secret environment variables. Review the free service before applying. Public hosting is complete only after Render reports the deploy live and HTTPS, authentication, a complete workflow, and the workflow have been checked.

`Dockerfile` runs the built Node application. `compose.yaml` additionally provides a Caddy HTTPS gateway for self-hosting. Do not expose the loopback supplier or bypass administrator authentication.

## Verification

Run `npm run check`, `npm run build`, `npm run test:e2e`, `npm run format:check`, and `npm audit`. Browser tests use local Chrome, or bundled Chromium in CI (`npx playwright install --with-deps chromium`). CI runs the same checks. No paid provider calls occur in these tests.

Opt-in live checks: `npm run smoke:remote:full -- --ai --compare`. This spends provider credits and writes an ignored receipt to `artifacts/remote-smoke.json`. The verified live run completed with TinyFish AI, 12 remote browser runs, real REA inspection, a Healthy workflow and zero outstanding sessions. Both comparison candidates passed, so recovery without REA was sufficient in this run. No causal REA improvement is claimed. TinyFish does not expose its underlying planner model version.

See `docs/implementation.md` for the supplier repair architecture and `docs/website-workflows.md` for real-site extraction limits. Formal PRD document-validator approval and event-rule acceptance remain separate from runtime verification.

`rea-agents` is pinned to 6.7.0, with its Zod dependency overridden to 4.6.7 for GHSA-mrhx-c7xc-m3w5. Real REA capture tests verify compatibility. Use `npm ci` with the lockfile.
