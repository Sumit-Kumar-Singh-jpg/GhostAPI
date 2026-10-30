# Reviewed delivery APIs

Phase 3 publishes the supported Amazon India delivery engine as a reviewed, product-specific API.
It creates a proposed contract from a completed check with confirmed PIN/variant evidence.
Actions come from the supported engine, not unrestricted inference from arbitrary websites.

## Use locally

1. Complete a delivery check with a supported confirmed verdict.
2. Choose **Review as API**. This creates a draft without another provider call.
3. Expand the contract. Inspect its fixed source URL, observed baseline, allowed domains/actions,
   input and result schemas, evidence requirements and limitations.
4. Check the review acknowledgement and choose **Publish local API**.
5. Use **Invoke fresh check** or the displayed POST endpoint with a PIN and optional variant.
   Each accepted invocation creates a fresh job and shares delivery concurrency/daily limits.
6. Poll its returned status_url. Inspect the result plus contract id, version and digest.
7. **Retire API** stops future invocations. Existing jobs and observations remain available.

Publishing is a local application operation. It does not deploy a service or expose the app publicly.
The fixed reviewed URL cannot be replaced through invocation inputs. UNKNOWN checks cannot be used
as publication baselines. An invocation can still return UNKNOWN or fail as the live source changes.

## Routes

- GET /api/delivery-workflows — saved versions and review state.
- POST /api/delivery-workflows with {job_id} — create a draft from supported observed evidence.
- POST /api/delivery-workflows/:id/publish with {digest} — acknowledge that exact draft.
- POST /api/delivery-workflows/:id/invoke with {pincode, variant?} — fresh execution; HTTP 202 with job_id/status_url.
- GET /api/delivery-workflows/:id/openapi — OpenAPI 3.1 input, response and polling documentation.
- POST /api/delivery-workflows/:id/retire — stop future calls to that version.

All routes use existing administrator authentication when configured. POSTs require the dashboard
client header and existing origin checks. OpenAPI documents the local/production session-cookie
name and client header. Keep credentials out of copied request examples.

## Version and evidence model

Contract specifications are immutable through this API. Drafting from a later completed result
creates the next version for that exact URL. Existing published versions remain addressable until
retired. Source job/run identities and the observed baseline are recorded. A SHA-256 digest binds
publication and invocation provenance to the reviewed specification. Storage is serialized and
atomically replaced; corrupted specifications fail closed on startup. Digest checking is an
integrity check, not a cryptographic signature proving retailer authenticity.

The fixed amazon-delivery-v1 executor continues to enforce PIN/variant/evidence rules. Contract
actions cannot add arbitrary code or prompts. Draft and retired contracts cannot execute. Retiring
a version does not cancel already accepted jobs. Active mutation blocks new calls until persisted.

Validation covers draft gating, digest mismatch, fixed URL enforcement, fresh invocations,
version provenance, persistence, retirement, corrupt records, authentication and the browser
review/publish/invoke/retire journey with fixtures. The underlying engine has prior real retailer
evidence; Phase 3 tests do not claim a new paid live run. General discovery and controlled repair
remain later work.
