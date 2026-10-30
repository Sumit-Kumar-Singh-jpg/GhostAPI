# Local readiness — Phase 6

The local milestone adds scheduled checks across shopping, internship review and verified
source APIs. Select **Monitor daily** on a completed result or verified candidate, then open
**Scheduled checks** for Check now, Pause/Resume, Remove and History. Setup saves the current
result as a baseline without another provider call. Partial results cannot become baselines.

## Scheduling and recovery

- Runs only while the Node server is awake. No external scheduler or notifications are installed.
- On restart, schedules wait a full interval. Missed runs are not replayed in a burst.
- Failed checks preserve previous observations and record an error. Interrupted checks are
  marked as errors; interrupted research jobs require a fresh request rather than silent retry.
- Shopping changes compare sourced facts. Internship changes compare assessment and findings,
  excluding timestamps. Source API checks revalidate the existing mapping; changed or broken
  mappings become errors and require rediscovery/review, not automatic client replacement.
- State is stored locally in DATA_DIR. Keep this directory to retain history between starts.
  Research and monitor records, and visual captures, use temporary files and atomic replacement.

## Resource limits

- At most 10 scheduled checks and one scheduled check running at a time.
- Daily cadence in the UI; the API also accepts 60- and 360-minute intervals.
- Most recent 20 history entries per monitor, with at most 30 changed fields per event.
- At most 30 research starts per tool in a rolling 24 hours, persisted across restarts.
  Fresh manual and scheduled research share this limit; cached reuse does not consume a start.
- Two concurrent research jobs per tool, 15-minute cache reuse, and up to 200 retained research
  jobs plus running work. Provider work may continue after local cancellation or timeout;
  late results are discarded. Run limits are not a monetary spending guarantee.
- Existing website extraction monitoring has its own cadence and does not use the research limit.

## Validation and remaining scope

The automated suite covers scheduler state, before/after changes, failed-read preservation,
restart recovery, persistent run limits, corrupt research storage, authentication and cross-origin
write protection. Browser coverage exercises creating a check, running it, viewing price changes,
pausing, reloading and mobile layout. Existing capture isolation and research tests remain in place.
Provider fixtures make these checks deterministic; they do not prove every live website works.

This milestone does not promise an exact interactive clone of every website, arbitrary API
discovery, product authenticity, independent seller/company identity checks, comprehensive fraud
detection, pincode-specific delivery totals or multilingual screening. Internship findings are
evidence and warning signs, not safe/fraud verdicts. Hosting remains a separate decision.
