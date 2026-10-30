# Local visual API builder

## Phase 2 rendered capture

The normal app now first loads the source in fresh local Chrome (or installed Playwright Chromium)
at 1280 × 800. Page scripts execute only in that disposable context. External requests are
intercepted and fulfilled through DNS-pinned public HTTPS reads. Browser credentials are never
forwarded. Writes, frames, service workers and sockets are blocked. Six bounded scroll steps
trigger lazy content. Computed styles, selected image sources and dynamic stylesheets freeze
the rendered state. Limits: 45 seconds, 180 reads, 32 MB of responses, 8,000 elements and 16 MB
of generated HTML. Browser captures reuse loaded asset responses instead of refetching them.

Open **Compare captured page and preview** for source and frozen-preview screenshots at the same
viewport. This is visual evidence, not a fidelity score. Failed browser capture produces an
explicit raw-HTML fallback. Shadow DOM, canvas, CSS imports and embedded media remain
limitations. Captures are serialized, duplicate requests share the active job, and screenshots
persist with format-version-5 captures. No paid remote browser sessions are used by this path.

The static bundler described below is still used after rendering and as the fallback. Source
scripts execute during isolated capture only; they cannot execute in the frozen preview.

Run `npm install` and `npm start`, then open http://127.0.0.1:3000. Development remains local: do not push to the Render-connected main branch until hosting is requested again.

Paste a public HTTPS URL. Inspection discovers extraction fields from the original response and TinyFish Fetch adds a bounded public content report when TINYFISH_API_KEY is configured. After inspection the visual builder automatically captures the page. Choose fields and approve the contract to activate data endpoints. Click a highlighted element or its inspector entry, then Test API. The result includes the last verified value, source and observation time; testing does not itself trigger a new source read. Use Check now for that.

The first implementation reproduces static HTML, inline styles, up to sixteen stylesheets and sixty-four media assets (each limited to 2 MB). Supported images and fonts are embedded; unavailable resources are counted in the preview notes. Stylesheets and visible page images take priority over CSS decoration. Four concurrent resource requests are allowed, with a 16 MB encoded media budget. CSS imports are omitted. Incomplete captures show a prominent quality notice. Versioned saved captures are rebuilt when the capture algorithm changes. The source is fetched through DNS-validated, pinned HTTPS requests, including every redirect and asset destination. NAT64 addresses using the well-known /96 prefix are checked against their encoded IPv4 destination.

The capture removes scripts, embedded frames, forms, navigation destinations and event handlers. An iframe with only allow-same-origin lets the parent attach field highlights; it does not allow scripts or form submission. The preview response has a restrictive CSP permitting only inline styles and bundled data images/fonts. No original page network scripts execute. Remote content never supplies application code or API route definitions.

Visual bindings derive from existing source-backed field selectors or a matching visible text value. A metadata field may have no visible match; it remains selectable in the inspector. Endpoints are generated extraction APIs, explicitly not discovered source network requests. Approval gates returned data and required-field failures withhold values.

## Local routes

- GET /api/websites/:id/visual: prepare/load capture and return binding metadata and limitations.
- GET /api/websites/:id/visual?rebuild=1: recapture source and assets explicitly.
- GET /api/websites/:id/preview: serve the prepared HTML with the preview CSP.
- GET /api/websites/:id/fields/:key: return one approved field from the latest successful observation, or 409.

Existing workspace authentication applies to every route. Captures are saved as visual-ID.json under DATA_DIR (ignored by Git). They include bundled page content and assets; do not commit them. Saved captures work without a new source fetch after restart. New captures, TinyFish reports and monitoring still need internet access.

## Next implementation stages

1. Extend the guarded rendered capture to more component types and selected linked pages.
2. Show observed source request method, URL, parameters and response schema separately from generated GhostAPI routes.
3. Support one verified interaction such as search or pagination; replay it through an explicit read-only boundary.
4. Expand to selected linked pages, route mapping, richer selectors and visual regression checks.

Whole-site cloning, arbitrary interactions, authenticated sites, automatic source API discovery and exact pixel fidelity are not implemented by this milestone. The local public-book smoke test exercised real capture, TinyFish discovery, approval, clickable overlays, a successful price endpoint, and a 390-pixel layout without overflow.

## REA clone evidence

Clone capture now records successful document and asset reads and invokes the installed REA CLI (`inspect-web-network-capture`) on a sanitized, caller-generated HAR. The application validates REA's evidence ID and artifact SHA-256, then derives the displayed document/style/image/font inventory from REA's normalized records. Field bindings cite the matching source-document evidence. REA failures explicitly show unavailable evidence while leaving the static preview usable.

The HAR omits credentials, headers, cookies, query strings, response bodies and timing claims. It records successful HTTP reads made by the clone transport, including reads fulfilling browser requests, rather than native CDP events. The generated DOM is never represented as an original HTTP response. Per-resource digests remain in the clone manifest; REA verifies the supplied HAR artifact digest. Neither digest independently certifies the website's values. Sanitized HAR files and REA output are saved in ignored DATA_DIR/captures; cached clones retain their evidence across restarts. Capture format version 5 invalidates older previews.

The API inspector shows a REA evidence panel, normalized request inventory, artifact identity and limitations. These requests are assets supporting the static capture, not automatically discovered business APIs. Browser interaction capture and correlation to original source data APIs remain a separate next stage.
