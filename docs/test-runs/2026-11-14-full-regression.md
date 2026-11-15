# November 14 complete backend regression

The complete Contenthub gate passed under Node **22.23.4**. It passed **203/203
unit cases**, the real SQLite lifecycle/HTTP suite, the disposable-server suite,
and the production admin build. The separate real PostgreSQL integration suite
also passed against a newly initialized, temporary PostgreSQL **16.10** cluster.
No application assertion was weakened, skipped or given retries.

## Final results

| Check | Result | Wall time | Evidence |
| --- | --- | --- | --- |
| `npm run check` | Exit 0; 203 units passed, 0 failed/cancelled/skipped/todo; SQLite integration, disposable server and admin build passed | 95.25 s | [Full backend log](/tmp/codex-full-regression-2026-11-14/backend-check-01.log) |
| `npm run test:unit -- check-runner` on the final runner | Exit 0; 4/4 passed, 0 failed/cancelled/skipped/todo | 4.68 s | [Final runner-unit log](/tmp/codex-full-regression-2026-11-14/backend-runner-unit-03.log) |
| `npm run test:integration:postgres` on the final runner | Exit 0; real lifecycle/HTTP suite passed | 59.14 s | [Final PostgreSQL log](/tmp/codex-full-regression-2026-11-14/backend-postgres-03.log) |
| `npm run test:server` after the real-stack admin setup repair | Exit 0; temporary admin build and real HTML/JavaScript delivery, published/draft blog boundaries and existing disposable-server checks passed | 53.64 s | [Final server log](/tmp/codex-full-regression-2026-11-14/backend-server-admin-01.log) |

The main Node test runner reported 4.087 seconds for its 203 unit cases. The
admin panel build phase reported 32.427 seconds. Integration and disposable
server scripts report suite-level outcomes rather than individual case counts;
those outcomes are not represented as invented numeric test counts here.

The same real HTTP helper runs on both databases. Its current coverage includes
canonical schedule previews, pricing and currencies, Standard owner editing,
ordered image relations, native second-row rollback, optimistic conflicts,
shared-lock edit/payment/pause concurrency, unchanged publication and entitlement
fields, paid orders and one-shot emails, staged/retired/shared media cleanup,
privacy erasure, Story workflows, wishes, expiry and POD contracts. The separate
server suite covers confirmed users, guarded controls, test-key rejection and
real HTTP creation/payment/refund/expiry with captured email.

## Commands and isolation

Final commands ran from the Contenthub repository:

```sh
rtk proxy env PATH=/Users/piyush.amola/.nvm/versions/node/v22.23.4/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /usr/bin/time -p npm run check > /tmp/codex-full-regression-2026-11-14/backend-check-01.log 2>&1
rtk proxy env PATH=/Users/piyush.amola/.nvm/versions/node/v22.23.4/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /usr/bin/time -p npm run test:unit -- check-runner > /tmp/codex-full-regression-2026-11-14/backend-runner-unit-03.log 2>&1
rtk proxy env PATH=/Users/piyush.amola/.nvm/versions/node/v22.23.4/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /usr/bin/time -p npm run test:integration:postgres > /tmp/codex-full-regression-2026-11-14/backend-postgres-03.log 2>&1
rtk proxy env PATH=/Users/piyush.amola/.nvm/versions/node/v22.23.4/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /usr/bin/time -p npm run test:server > /tmp/codex-full-regression-2026-11-14/backend-server-admin-01.log 2>&1
```

`scripts/run-check.cjs` removes inherited database URLs, provider credentials,
`NODE_OPTIONS` and project `.env` access. It uses `ENV_PATH=/dev/null`, dummy
credentials, the external-network guard, temporary configuration/uploads and a
new SQLite file. PostgreSQL mode uses local `initdb`/`pg_ctl`, a fresh temporary
data directory, a newly allocated loopback port and dummy credentials; it never
connects to an existing database. Its temporary cluster is stopped and removed
on completion. The existing local PostgreSQL server was not used or changed.
Email and payment-provider boundaries remained stubbed. No production database,
payment, email, CMS publication or other production write formed part of these
tests.

## Earlier attempts and harness diagnosis

| Attempt | Result | Evidence |
| --- | --- | --- |
| PostgreSQL 01 | Exit 1 after 46.19 s: `initdb` hit the existing 30 s setup timeout before any application test | [Log](/tmp/codex-full-regression-2026-11-14/backend-postgres-01.log) |
| Runner unit 01 | 3 passed, 1 failed: the newly added test inspected `-w` instead of the value after `pg_ctl -o`; corrected the argument lookup | [Log](/tmp/codex-full-regression-2026-11-14/backend-runner-unit-01.log) |
| Runner unit 02 | 4/4 passed, 2.55 s, with the temporary initialization-only change below | [Log](/tmp/codex-full-regression-2026-11-14/backend-runner-unit-02.log) |
| PostgreSQL 02 | Exit 1 after 39.49 s: initialization still timed out with temporary `initdb --no-sync`; this did not fix the failure | [Log](/tmp/codex-full-regression-2026-11-14/backend-postgres-02.log) |
| Bounded initialization diagnosis | Normal `initdb` arguments succeeded in 21.448 s in a fresh throwaway directory, with a 120 s diagnostic bound; no server was started and the directory was removed | [Log](/tmp/codex-full-regression-2026-11-14/backend-initdb-diagnostic-01.log) |

The diagnostic command invoked `/opt/homebrew/opt/postgresql@16/bin/initdb`
through Node 22 `spawnSync`, with sanitized environment, inherited output and
`timeout: 120000`. Its arguments were `-D
/tmp/contenthub-pg-diagnosis-c4hcEq/pgdata -U regression --auth=trust
--encoding=UTF8 --no-locale`. It showed post-bootstrap initialization followed by
successful disk synchronization. It does not establish that filesystem sync
caused either earlier timeout.

The ineffective `--no-sync` change was **reverted**. The final PostgreSQL pass
used the original initialization arguments, 30 s setup timeout, 5 minute
application timeout and normal server fsync/WAL/transaction settings. The only
retained runner change includes captured stdout together with stderr and the
spawn error in future PostgreSQL setup failures. Runner coverage also asserts
the exact unchanged loopback/socket server options. Application source needed
no fix for the passing backend gates. The full admin build was not repeated
solely for this PostgreSQL diagnostic change.

## Real-stack admin setup repair

The later cross-app Chromium POD admin case failed before login: the browser
received `404` from `/admin/auth/login`. Its trace and CMS log showed Strapi
trying to open the package fallback `server/build/index.html`, which did not
exist. The launcher had not built its own admin files and could not rely on a
checkout build remaining available. No order action had run at this failure.

`scripts/start-regression-server.cjs` now copies `src`, `config`, `data` and
`package.json` into its owned temporary app. It links installed dependencies
individually while keeping mutable dependency caches inside that temporary
app. The installed Strapi CLI builds the real admin, including the POD plugin,
there before the served app loads. The child uses the sanitized dummy
environment and external-network guard. The copied app has no `.env`; this
also avoids Strapi's build helper reading the checkout's `.env` independently
of `ENV_PATH`. The SQLite database, generated files, bundle and uploads all
remain temporary. No checkout, development or production admin bundle is
created or replaced.

The admin-build child has a 90-second deadline followed by a bounded hard kill,
and shutdown terminates that owned child before deleting its files. The
server-smoke readiness allowance changed from 90 to 120 seconds because setup
now includes a fresh real admin build and CMS boot. This matches the existing
cross-app setup budget. UI action/assertion deadlines and zero retries remain
unchanged.

The focused server gate passed in 53.64 seconds after independent source
review. Its new checks require HTML containing the Strapi app root and at
least one same-origin JavaScript entry, then fetch each entry and require a
nonempty JavaScript response. The same run retained the published/draft-only
blog token boundaries, confirmed login, guarded controls, test-key rejection,
creation/payment/refund/expiry and captured-email checks. This HTTP smoke does
not claim that the full POD admin browser interaction passed; the separate
cross-app run records that result.

The second cross-app attempt later finished with 68 passes and 13 WebKit
timeouts after the laptop entered repeated clamshell sleep. The first Story
failure's trace stopped polling at 01:58:35 IST and resumed at 02:08:29;
the coordinating runner matched this to the macOS power log's 01:58:34
`ClamshellSleep` and 02:08:29 `DarkWake`. The POD admin and pricing test bodies
completed, then context teardown stalled for roughly 1,013 and 1,023 seconds.
These gaps exceed their original test deadlines and occurred at unrelated
browser setup/cleanup points. No application fix, longer action timeout or
retry was added for this host suspension. The awake WebKit rerun is recorded
separately in the frontend run report; this does not change the passing
backend server-gate result above.

## Warnings and limits

Fresh boot logs retain the existing example category/author seed errors,
duplicate macOS Sharp/libvips warning, missing upload-security configuration
warning and deprecated Strapi update-notification setting warning. The admin
build also reports dependency annotation warnings. These were not suppressed;
the completed assertions/build exited successfully despite them. A passing gate
does not certify the obsolete sample seed data.

Frontend browser, iPhone, cross-app and media results are recorded by their
respective runners in the sibling frontend report. Live Razorpay sandbox,
production SMTP/OAuth, physical-device behavior and production infrastructure
were not exercised by these isolated backend gates.
