# October 30 backend scope

See `../birthday-celebration/docs/2026-10-30-eu-readiness-implementation.md` and the removal handoff. Scheduled retention cleanup remains. The owner removed the custom privacy/withdrawal request collection/API, early-delivery acknowledgment requirement, saved contract terms and extra purchase confirmation email. The October 31 follow-up also removes the self-service celebration erasure route, controller and permission grants. Original payment creation payloads are restored; pricing, ownership, verification, expiry and cleanup guards remain.

Private celebrations remain until one calendar year after their original public-window end; never-published checkout drafts follow creation. Public removal retains the private draft and media. Individual deletion requests use support email; reminders are deferred. See `../birthday-celebration/docs/2026-10-30-one-year-celebration-retention.md`.

Relevant unit and isolated database/HTTP cases are wired into the existing gates. No tests or verification commands were executed for these source changes. Existing generated type edits were preserved. No production database, payments, mail or deployment operations were performed.

The October 31 recovery restored this work from stash commit
`f817efd1ad900cf1d18b49973b2906639d7e7a5c` without dropping the stash or
overwriting the newer generated types. The self-service erasure feature remains
removed after recovery. See the frontend removal handoff for backup details.
