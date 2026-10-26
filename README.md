# GhostAPI

GhostAPI repairs a saved read-only website workflow when its source changes, and publishes a quotation only after independent verification. The demo supplier switches from tax-inclusive prices to prices before tax; the app detects the mismatch, inspects evidence with REA, proposes a bounded configuration patch, tests it, then activates it provisionally and performs a final replay.

## Run

Requires Node.js 24 and npm. Run `npm ci`, then `npm start`, and open http://127.0.0.1:3000. The executor supplier runs separately on loopback port 3001; the dashboard provides an authenticated same-origin supplier preview. Click **Run local demo** for the complete deterministic presentation. MOTOR-01 × 1 verifies to ₹1,180. All supplier prices and tax rates are synthetic.

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

See `docs/implementation.md` for architecture and limits. The project repairs its enrolled synthetic supplier workflow, not arbitrary websites. Formal PRD document-validator approval and event-rule acceptance remain separate from runtime verification.

`rea-agents` is pinned to 6.7.0, with its Zod dependency overridden to 4.6.7 for GHSA-mrhx-c7xc-m3w5. Real REA capture tests verify compatibility. Use `npm ci` with the lockfile.
