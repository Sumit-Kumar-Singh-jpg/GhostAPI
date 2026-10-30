# Inline TinyFish browser view

Shopping now embeds an active delivery session in **Watch TinyFish work**. The panel appears
between the delivery form and results. A selector switches between active PIN checks; Watch here
and Watch in this page buttons select a session without leaving GhostAPI. Queued checks show
their status while waiting for a provider viewing URL.

The iframe remains mounted while progress/results poll, avoiding repeated viewer reconnections.
Terminal jobs remove their iframe and temporary link; evidence stays available. Viewing URLs
remain in memory and are not added to persistent records. Frames use no-referrer and a sandbox
allowing scripts/same-origin for the remote viewer, without top navigation, forms or popups.

The parent content policy permits frames only from this app, the observed provider domain
https://*.tetra-data.production.tinyfish.io and the exact redirect destination
https://tetra-streaming.tinyfish.io. Other URL hosts use the explicit external fallback.
No reverse proxy bypasses provider framing controls. Viewer failure does not cancel the job.
Cross-origin framing failures cannot always be detected reliably, so the panel explains how to
use the separate-window fallback if blank or expired. Frame load alone is not claimed as proof
of a connected browser session.

Browser fixtures verify frame loading, stable mounting, PIN switching, terminal cleanup and mobile
overflow. A real embedding verification was attempted on 30 October 2026 but automation returned
HTTP 503 before a run/view URL; subsequent provider history reads also returned 503. An earlier
saved viewing URL had expired with HTTP 404. Therefore active provider embedding is implemented
but not yet confirmed against a fresh live session. No retry was started while run history was
unavailable. See ignored artifacts/delivery-inline-fixture.png for fixture UI evidence.

This supersedes earlier documentation describing external viewing as the sole supported UI.

## Framing-block diagnosis and fix

The reported browser block reproduced as a parent frame-src violation: the initial provider URL
redirected to tetra-streaming.tinyfish.io, which the original allowlist omitted. The provider
returned HTTP 200 with no X-Frame-Options or frame-ancestors restriction. The fix allows that exact
redirect host in CSP and in the client URL guard, without stripping provider headers or proxying
around restrictions. The regression test covers embedding on the final host, stable mounting,
PIN switching and terminal cleanup.

A fresh real run (e0b6a2dc-ae57-441c-8213-63a803ddbc31) loaded its viewer inside the app with HTTP 200
and one rendered browser canvas. The run completed with UNKNOWN; viewer success is not delivery
verification. The first visible browser frame is saved in ignored artifacts/delivery-inline-live.png.
The earlier HTTP 503 verification blockage is no longer the latest outcome. Completed session URLs
expire with HTTP 404 and should not be treated as reusable recordings.
