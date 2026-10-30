# Delivery monitoring and reviewed recovery

## Monitor a published API

Invoke a published delivery API once and obtain a confirmed result. Select **Monitor daily** on
that result. This schedules the exact contract version, PIN and optional requested variant.
Setup uses saved evidence and makes no provider call. Each subsequent scheduled or manual check
starts a fresh TinyFish run and shares the delivery daily/concurrency limits.

Use **Scheduled checks** for Check now, Pause/Resume, Remove and History. Changes compare
confirmed PIN, actual variant, availability, delivery message and contradiction. Time passing
alone is not a value change. UNKNOWN, failures and cancellation preserve earlier confirmed
observations and record an error, rather than turning missing evidence into unavailable delivery.

Schedules run only while this local server is awake. Restart postpones checks by one interval;
missed runs are not replayed. Existing limits apply: ten monitors, one scheduled check at a time,
twenty history events per monitor, thirty delivery starts per rolling day and two active local
delivery runs. Manual checks, matrix rows and replacement validation consume the same daily quota.
Local abortion does not guarantee remote cancellation or a hard monetary spending cap.

## Workflow health

The reviewed API card reports its latest execution state. Provider rejections, timeout, execution
failure and reported page access blocks are distinguished. Two consecutive completed UNKNOWN
results without a reported access block flag **suspected drift**. This is a review signal, not
proof that page structure changed: PIN-specific ambiguity and ordinary evidence gaps may also
produce it. Confirmed availability changes are ordinary observed changes, not workflow drift.

## Prepare and validate a replacement

1. Inspect the failed/uncertain run and source. Obtain a newer confirmed check for the same URL
   using the existing delivery flow. Do not bypass access controls or fabricate evidence.
2. On the published API card, select that observation under **Confirmed observation for replacement**
   and choose **Prepare replacement draft**. The original remains published.
3. Review the proposed baseline and specification. The digest binds the replaced version's ID and
   digest as well as the proposed contract.
4. Choose **Validate replacement**. This starts up to three fresh regression checks, including
   the replacement and original baseline inputs, deduplicated with other known successful inputs.
   Jobs execute sequentially within shared quotas. Their IDs and results appear on the draft.
5. Review every result. Publication requires all planned cases to complete with confirmed evidence
   for the same draft digest, with starts in the last fifteen minutes. Failed, missing, partial or
   UNKNOWN validation cannot activate a replacement. An interrupted or quota-limited validation
   must be explicitly repeated; no automatic paid retries occur.
6. Check the review acknowledgement and publish. The new version becomes published and the old
   version becomes retired in the same persisted contract update. Earlier jobs remain available.
7. Invoke the replacement and explicitly enable its monitor. Monitors do not silently move to a
   different contract: an old-version monitor reports retirement and preserves its last values.
   Pause/remove that old monitor when you switch.

This recovery flow refreshes and revalidates a version of the existing bounded delivery engine.
It does not generate arbitrary executable code, change allowed actions automatically, or claim
universal autonomous repair. Broader structural repair requires a separately implemented executor
and its own validation. No public hosting or external notifications are provisioned.

## API additions

- POST /api/monitors with action create and target {kind: "delivery", workflow_id, pincode, variant?}.
- POST /api/delivery-workflows with {job_id, replaces_id} proposes a replacement from newer evidence.
- POST /api/delivery-workflows/:id/validate explicitly runs fresh regression checks.
- Existing publish route activates a validated replacement and retires its parent.
- GET /api/delivery-workflows includes health; saved jobs include failure reason codes when available.

All use existing authentication and origin checks. Source text remains untrusted content.
Tests use fixture providers for observed changes, uncertainty preservation, access failures,
validation gating, parent retirement and the browser recovery journey. They add no new claims
about live retailer reliability beyond the prior single-PIN and matrix evidence.
