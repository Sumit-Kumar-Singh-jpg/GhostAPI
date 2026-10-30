# Local release check — 30 October 2026

The four focused delivery phases are implemented for the supported Amazon India workflow.
The local app includes delivery checks, three-PIN comparison, reviewed APIs, scheduled checks
and validated replacement versions. General workflow discovery and arbitrary structural code
repair remain outside the supported scope. No deployment is part of this release check.

## Run and use

From the repository, install dependencies with npm ci if needed, then run npm start.
Open http://127.0.0.1:3000 and select Shopping Assistant. TinyFish configuration stays in the
local ignored .env file. A fresh GitHub clone needs its own local environment configuration.

Enter an Amazon India laptop product URL and a six-digit PIN. Add up to two comma-separated
PINs for a matrix. Every PIN starts a fresh provider run and shares the daily limit of thirty
delivery starts. Two local runs execute at a time. Select a live-view link while available;
temporary viewing links expire and are excluded from saved reports.

On a confirmed result, choose Review as API, review the contract, acknowledge it, and publish
locally. Invoke that API for a PIN, then enable Monitor daily on its confirmed result. Scheduled
checks and history are in the shared Scheduled checks panel. They run only while this server
is awake and do not backfill missed runs.

For recovery, inspect the source and obtain newer confirmed evidence. Prepare a replacement
draft from the published API, validate its regression inputs, review the results and publish.
This retires the old version. Explicitly enable monitoring for the replacement and pause/remove
the old monitor; monitors do not silently switch contracts.

## Evidence and verification

Earlier real TinyFish runs confirmed the tested laptop listing for PINs 560064, 110001 and
400001. All three outcomes matched. Those timestamped observations do not guarantee current
or future availability. An earlier unconfirmed observation correctly evaluated to UNKNOWN.
Live viewing URL availability was observed; embedding and recording were not promised.

Backend validation passed 75 tests. The complete combined browser suite passed fourteen tests covering
the supported tools and delivery publishing/recovery journey. Provider fixtures make automated
tests deterministic and are separate from real saved evidence. Build, formatting and diff checks
passed. The local health endpoint and updated frontend module were verified after startup.

The readiness pass also fixes input loss during background refresh: unchanged contracts retain
PIN, variant, focus, selected replacement source and expanded contract details. Review acknowledgement
is retained only for the same contract digest and validation-job set. Stale network refreshes are
discarded so they cannot replace newer UI state.

Known limits: agent-reported evidence, a bounded retailer scope, local-only scheduling, provider
work potentially continuing after local cancellation, and no hard monetary cap. See
delivery-implementation.md, delivery-workflows.md and delivery-monitoring.md for exact behavior.
