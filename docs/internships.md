# Internship evidence checker

Use Internship Checker -> paste a listing URL or description -> optionally supply a company
website you independently recognize -> Check online. Save request does not run a check.

The optional reference website is a user-supplied comparison baseline, not a certified official
domain. TinyFish reads the listing and reference, then up to two linked careers pages on the same
reference hostname. A separate reference page linking to the exact listing supports association.
The listing cannot corroborate itself. Redirected/unavailable listing pages and missing careers
links remain unresolved. Search results, when available, are labeled leads rather than official sites.

## Findings

- Supporting evidence found: a separate reference page links to the readable internship listing.
- Needs verification: missing sources, description-only screening or unresolved corroboration.
- Strong warning signs: explicit upfront-payment or credential requests in the inspected text.

Warnings include excerpts and their source. Common negative advice such as “never charge fees”
or “do not share your OTP” is excluded by the bounded rules. This is English-language screening,
not general semantic analysis: it can miss paraphrases and cannot determine intent or prove fraud.
Domain mismatches and external recruiting platforms are questions, not accusations. A supporting
link never overrides an explicit warning. No confidence percentage or safe/fraud verdict is used.

Description-only checks without a reference URL stay local. Raw description text is never used as
a search query. Submitted requests and findings are saved locally; do not include private IDs or
credentials. No forms are submitted, recruiters contacted, or applications sent.

## Execution

Shared ResearchJobs handles shopping and internship runs: two active runs per tool, 60-second
publication deadline, 15-minute explicitly labeled cache, fresh checks, cancellation and interrupted
run recovery. Cancellation discards late results; an already-sent provider request may finish.
Source timestamps show check time and TinyFish may return upstream-cached content.

Results live in DATA_DIR/internships.json. Existing authentication and request-origin checks cover:

- GET /api/internships
- POST /api/internships with request_id and optional fresh
- POST /api/internships/:id/cancel

Validation covers positive reference links, suspicious requests, negation, missing sources, domain
mismatches, blocked pages, local descriptions, persistence and UI/cache flow. The bounded live
provider smoke reads one public internship-information page and issues no legitimacy verdict.
