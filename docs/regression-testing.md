# Regression checks

## October 31 stash recovery and celebration erasure removal

Restored the October 31 stash containing one-year retention, scheduled cleanup,
early guest wishes, price validation and POD uniqueness changes. The original
stash remains available and current generated types were preserved. The custom
celebration erasure route/controller and its permission grants were removed to
honor the owner's later request. Scheduled cleanup and its media retry guards
remain. HTTP cases expect the retired endpoint to be unavailable (404 or the
Strapi fallback's 405), with documents/media retained. Next.js cases expect 404.
No tests, builds, typechecks, browser or stack checks were run for this recovery.
See `../birthday-celebration/docs/2026-10-31-remove-celebration-erasure.md`.

The [October 30–31 full regression report](../../birthday-celebration/docs/test-runs/2026-10-30-full-regression.md)
records the completed explicit test request: 168 backend units, real SQLite
and PostgreSQL integration, disposable-server checks and the admin production
build passed. The frontend's complete browser run, post-fix pricing/API follow-up,
75 real-stack cases and 206 iPhone/WebKit cases also passed. The report preserves
the failures and fixes rather than treating earlier diagnostic passes as proof.

`npm run test:integration:postgres` now runs the same real lifecycle/HTTP
integration suite as `test:integration` against a disposable PostgreSQL cluster.
It uses the existing `initdb`/`pg_ctl` isolation, a newly allocated loopback port,
dummy credentials and a temporary data directory; it never inherits database
URLs or connects to an existing database. Set `REGRESSION_PG_BIN` when the tools
are not at the runner's detected PostgreSQL 16 location. The cluster is stopped
and removed on completion. The normal `npm run check` remains SQLite-based;
this additional command checks database-specific behavior, including concurrent
guest-wish appends, with the same assertions. Runner isolation is covered by
`tests/check-runner.test.js` in the normal unit gate. October 30–31 execution
results are recorded in the frontend's dated full-regression report.

The October 30–31 full regression also adds real price-write checks before
PostgreSQL decimal rounding, backed by `tests/premium-pricing-input.test.js`.
Current prices reject fractions of a cent/paise; over-precise optional original
prices are cleared before persistence. Both database integration suites retain
the HTTP quote and ownership assertions. The POD helper now checks one persisted
capture row and runs 20 six-worker HTTP lease races on disposable data. The
focused PostgreSQL run and final SQLite gate passed these expanded checks;
the dated report preserves the earlier failures and their diagnosis. A later
row-count check reproduced duplicate captures and confirmed that the attribute
`unique` flags had not created database constraints. Explicit schema indexes now
enforce uniqueness for the order key and provider reference. Regression coverage
also rejects direct duplicate writes, checks the saved winning token and denies
sequential claims before its lease expires.

Before deploying these indexes to an existing database, run these read-only
preflight queries:

```sql
SELECT order_key, COUNT(*) FROM pod_orders
WHERE order_key IS NOT NULL GROUP BY order_key HAVING COUNT(*) > 1;

SELECT reference, COUNT(*) FROM pod_orders
WHERE reference IS NOT NULL GROUP BY reference HAVING COUNT(*) > 1;
```

Resolve any returned groups by reviewing their submission/provider history
before deployment. The schema sync adds the unique indexes on startup and will
reject conflicting existing rows. This change does not delete, merge or rewrite
orders automatically. Fresh disposable SQLite/PostgreSQL tests cover the new
constraints; production data and an existing-database upgrade are separate
deployment checks.

## COD and POD admin

See [the COD/admin handoff](shopify-cod-admin-handoff.md) and
[the October 29 execution report](test-runs/2026-10-29-cod-admin.md).
`tests/helpers/pod-admin-regression.cjs` runs through the existing POD integration
suite, `npm run test:pod`, `npm run test:pod:postgres` and `npm run check`. It tests
real admin sessions/RBAC, notes and audit rollback, filtering/pagination,
pause/intent races, validation states, locked/stale edits, raw Content Manager
bypass denial and historical records. Cross-app/browser coverage lives in
`../birthday-celebration/tests/stack/pod-cod-admin.spec.ts`. Synthetic data only;
provider submission stays disabled in real HTTP/browser tests.

## Generic Shopify–Qikink connector

See [the Shopify handoff](shopify-production-handoff.md) and [generic execution report](test-runs/2026-10-27-generic-pod.md). Unit, private HTTP/database and real cross-app checks cover generic product mappings, multiple placements, capture, leases, cancellation and uncertain-result reconciliation. `npm run test:pod` and `npm run test:pod:postgres` in Contenthub run focused isolated database checks. No live provider writes belong in these gates.

## October 18 Standard to Story prefill

The server-token-only `POST /api/birthday-stories/from-standard/:slug` reads a
published, unexpired Standard celebration for the owner resolved by Next.js.
It returns names, the existing headline and photo captions, music, up to three
stored photo URLs, and a sufficiently future trigger converted into the new
Story country/browser timezone. It creates no draft, copies no payment
entitlement, and never changes the original Standard or its expiry. Browser
JWTs, anonymous calls, another owner, Story sources, expired and deleted
sources cannot use this read. The frontend provides the private same-origin
photo copy and uploads each image as a new Story asset only at checkout.

`tests/story-from-standard.test.js` covers mapping, owner/route/expiry rules,
and future/live schedule handling. `tests/helpers/story-from-standard-regression.cjs`
is called by the existing real HTTP regression helper and checks the actual
policy/router/database contract, no-write read, owner isolation and schedule
conversion. Matching frontend fixture/API/browser, mapper and real-stack
coverage is in the sibling repository under `story-from-standard` and
`standard-to-story`. No schema change or migration is required.

**No tests, typechecks, builds, lint, browser verification or media renders
were run for this request.** Deploy this backend endpoint before the frontend
prefill UI. Existing generated type edits were not part of this change.

The later explicit complete-regression request passed `npm run check`: 134 unit
tests, real Strapi/SQLite and HTTP integration, disposable-server checks and
the production admin build. The frontend's 734 browser/API cases, all 54 real
cross-app journeys and 98 expanded iPhone cases also passed. The actual source
route and ownership/no-write rules ran through real HTTP; the cross-app import
case copied separate Story assets, verified simulated payment and published
the Story while retaining unchanged free Standard access. See the
[October 18 execution report](../../birthday-celebration/docs/test-runs/2026-10-18-full-regression.md)
for failures, repairs, exact gates, artifacts and remaining limits. The
no-execution paragraph above describes the original implementation request.

Test execution is opt-in. Run these commands only when the current request
explicitly asks for testing, using Node 22 (the supported runtime in
`package.json`) and npm. From this repository:

```sh
npm ci
npm run check
```

`check` runs the unit tests, real Strapi/SQLite integration tests, disposable full-stack server checks, and the production admin build. It exits with a failure when any stage fails. No paid testing service or extra test framework is required.

| Command | Purpose |
| --- | --- |
| `npm run test:unit` | Fast service and authorization policy tests with database/provider doubles |
| `npm run test:integration` | Real Strapi schema, service, migration, and HTTP checks against a new disposable SQLite database |
| `npm run test:birthday-story` | Alias for the integration suite; existing callers can keep using it |
| `npm run test:server` | Boot the disposable full-stack server and verify its HTTP flows and shutdown cleanup |
| `npm test` | All backend regression tests |
| `npm run build:check` | Compile the production admin bundle with disposable configuration |
| `npm run check` | The full local gate |

The runner supports macOS and Linux (`/tmp` and `/dev/null`), including the Ubuntu GitHub Actions job. It does not load the repository's `.env` or inherit database URLs, provider secrets, or `NODE_OPTIONS`. It supplies dummy credentials, turns off cron/telemetry, and uses a fresh SQLite file and temporary uploads. Tests deny outgoing TCP/fetch connections except explicit loopback requests to the test server. Razorpay and email are stubbed. Temporary databases and uploads are removed after the integration run; the launcher also removes its temporary directory after failure. Dependency installation still needs access to the npm registry.

## What is protected

- Scoped API failure logging for celebration and account endpoints: status/method
  grouping, correlation headers, validation field names, privacy filtering,
  unchanged request outcomes and logger failure isolation. Unit and real HTTP
  coverage are added but unrun for this source-only request. See
  [API failure logs](api-failure-logs.md) for search terms and deployment details.
- The real HTTP creation contract also covers the existing `customroute`
  three-character minimum: one-/two-character names leave no record, while a
  three-character name publishes. These added cases are unrun for the
  production-log follow-up request.

- Celebration email delivery: draft rows send nothing; the first committed publication claims one persistent, uniquely keyed delivery. Updates, republishing and restart backfills cannot resend it. SMTP failures are recorded without automatic retries. Provider and auth-template Reply-To use `wishhappybday@gmail.com`. Covered by `tests/email-settings.test.js` and `tests/helpers/celebration-email-regression.cjs` in the existing integration gate.

- Pricing conversion to payment units for Standard Premium and Birthday Story;
  optional original prices are display metadata, new orders use current
  prices and existing orders keep their saved amount/currency. See the
  [pricing contract](pricing.md) for the major-unit CMS fields and minor-unit
  API values.
- Checkout ownership, valid purchase IDs, demo/expired/deleted celebrations, and reuse of another celebration's payment attempt.
- Payment signatures, provider capture status, order ownership, payment and order amount/currency checks.
- Duplicate captures, duplicate/retried webhooks, partial/full refunds, and preserving the original payment's entitlement.
- Capture after expiry/deletion records the payment for refund without restoring access or extending expiry.
- Owner/admin policies, private story routes, free/paid feature access, and the 24-hour legacy expiry fallback.
- Cleanup rechecks records before unpublishing, handles duplicate rows, and continues after a per-record failure.
- The existing story integration covers private drafts, owner isolation, upload duration/content limits, optimistic revision checks, paid publication, private edits versus published content, wishes, 24-hour expiry, migration idempotency, no republishing, concurrent checkout and recovery of interrupted checkout.
- Real HTTP requests cover password login, failed login, sanitized `/users/me`, dashboard routing and pagination, another user's empty dashboard, forbidden cross-owner pause, owner pause/resume, and authenticated API-token pricing/access response shapes.
- Access responses include `contentVersion` from the published celebration's `updatedAt`. The frontend uses it to keep late cached reads separate from newer messages and wishes. Unit coverage checks string/Date/missing timestamps without changing entitlements; real HTTP coverage updates a guest wish, checks that the version changes, and reads the persisted published wish. This adds no schema field or migration.

## CI and merge protection

`.github/workflows/regression.yml` runs on every pull request, merge queue group, pushes to `main`/`master`, and manual dispatch. It installs the lockfile with `npm ci` on Node 22, runs tests, and builds Strapi. The job has no production secrets and cannot deploy.

After the first workflow run, configure your GitHub branch rules to require the **Backend regression** status check, require a pull request, and require branches to be current before merging. CI reports failures; branch rules are what prevent a failing change from merging. Those repository settings are not changed by these files.

## Real frontend and backend tests

The sibling frontend's full-stack launcher can start this actual Strapi application with `scripts/start-regression-server.cjs`. Each launch owns a new SQLite database and uploads directory under `/tmp/contenthub-fullstack-*`. It seeds confirmed `creator@example.test`, `other@example.test`, and `admin@example.test` accounts with password `Regression-test-123!`, normal role permissions, a disposable API token, and standard/story prices. Email delivery is captured in memory. The app's real routers, controllers, services, schemas, and upload provider run normally.

Only this disposable launcher raises the users-permissions login limit to 100 requests per interval. All Next server calls otherwise share Strapi's ten-request loopback bucket, which incorrectly groups the suite's independent visitors. Rate limiting remains enabled and Next's visitor limits remain unchanged. The server smoke test crosses the ordinary ten-login threshold. Production configuration is not changed.

```sh
node scripts/start-regression-server.cjs \
  --port 4331 \
  --frontend-origin https://localhost:4332 \
  --ready-file /tmp/your-isolated-test-run/backend-ready.json \
  --tls-key /tmp/your-isolated-test-run/key.pem \
  --tls-cert /tmp/your-isolated-test-run/cert.pem \
  --payments mock
```

The launcher binds only to loopback. TLS is optional for standalone HTTP checks, but the browser suite uses it because the production frontend's CSP upgrades insecure image URLs. Supply a certificate with `localhost` and `127.0.0.1` SANs, and trust it through the parent launcher's `NODE_EXTRA_CA_CERTS`; do not disable TLS verification. The backend preserves that CA setting.

The readiness file is written atomically with mode `0600`. It contains `{version, cmsUrl, paymentMode, frontendEnv, users, control}`. `frontendEnv` provides the local CMS URLs, disposable API tokens, provider key ID, and a dummy webhook secret. It never contains the Razorpay key secret. Do not publish this file or include it in traces. The server removes its readiness file, database, and uploads on SIGINT/SIGTERM. Test controls exist only when this launcher mounts them; normal Strapi startup does not expose them.

All controls require `Authorization: Bearer <ready.control.token>`. Paths below are relative to `ready.control.baseUrl`:

| Method and path | Behavior |
| --- | --- |
| `GET /state` | Record/upload/mail counts and mock provider order/payment/call counts |
| `GET /pricing`, `PATCH /pricing` | Mock mode only: read or edit the eight supported current/original price fields in the isolated real singleton; returns `{data}` so tests can restore previous values |
| `GET /celebrations/:slug` | Real draft/published rows, related purchases, and retained image/story media; owner fields exclude password hashes |
| `POST /celebrations/:slug/expire` | Set expiry in the past and run the real unpublish cleanup |
| `POST /celebrations/:slug/schedule` | Disposable test server only: set `triggerAt` and its 24-hour expiry on both copies to exercise countdown-to-live transitions without waiting |
| `GET /outbox?email=...` | Captured email content, including real registration/reset links |
| `GET /users?email=...` | User IDs, email, confirmation state, and role |
| `POST /payments/:orderId/capture` | Mock mode only: capture at the provider boundary and return a signed payment callback and webhook; the real verification/webhook route must still grant access |
| `POST /payments/:paymentId/refund` | Mock mode only: set refunded total and return a signed refund webhook for the real application to process |

Capture accepts optional `paymentId`, `amount`, and `currency` fields for negative verification cases. Refund accepts optional `amount`, defaulting to the full payment. Neither control directly grants or revokes application access. Their response includes `{eventId, webhook: {rawBody, signature}}`; capture also returns `{orderId, paymentId, signature}` for payment verification.

The pricing control uses the same required bearer token and returns 409 outside
mock mode. Unsupported fields, empty payloads and invalid schema writes return
400. The control is mounted only by the disposable launcher, never normal
Strapi startup. Tests changing prices must restore the returned values in
`finally` and revalidate the frontend's public price tag; the control does not
grant access, create provider orders or silently clear Next's cache.

`--payments razorpay-test` preserves the real provider service. It requires explicitly passed `REGRESSION_RAZORPAY_KEY_ID` and `REGRESSION_RAZORPAY_KEY_SECRET`; a missing key, dummy key, or key without the `rzp_test_` prefix is rejected before Strapi boots. Only that mode permits outgoing connections to `api.razorpay.com`, and mock capture/refund controls return 409. Real provider test orders/payments remain in the provider's test dashboard; local shutdown does not delete remote provider history. Run this mode only as an explicitly authorized sandbox check. Ordinary `npm run check` remains offline and uses the provider mock.

## Adding features and fixing bugs

Follow the repository's [change and regression test rules](../AGENTS.md) for every change. They tell coding agents when to add tests, where to put them, and which checks to run before marking work complete.

Add a behavior test for each new feature and a regression test for each fixed bug. Put pure service/policy cases in `tests/*.test.js`; the runner discovers these files automatically. Add database relationships, constraints, publication, or migration cases to `scripts/test-birthday-story.cjs` or an integration suite wired into `scripts/run-check.cjs`. Add HTTP contract cases to `tests/helpers/http-regression.cjs`. Stub external providers at their network boundary and assert user-visible outcomes or persisted state. When testing is explicitly requested, run the appropriate gate and record its actual results; otherwise record that it was not run.

Do not delete or weaken a failed assertion just to get a green build. Decide whether the behavior change is intended; update the corresponding contract and tests together when it is. Keep the test database separate from development and production.

## Limits and existing warnings

No test suite can prove that every future change is safe. These checks cover the listed paths, not every CMS type or every input. SQLite cannot prove PostgreSQL-specific SQL, migration behavior, or production concurrency. Live Razorpay capture/refunds/webhooks, SMTP delivery, Google OAuth, browser rendering/media exports, and production infrastructure need separate provider sandbox/staging checks. The frontend has its own browser checks in its repository.

The current bootstrap attempts to seed old example article/category types and catches/logs some errors during a fresh database boot. The integration assertions pass after bootstrap; a green run does not certify this sample seed data. Strapi also currently warns about missing admin encryption configuration, and the local macOS Sharp installation can report duplicate libvips classes. These are existing application/dependency warnings, not suppressed by the test harness.

## October 14 single Story theme

`normalizeStory` now returns `theme: pastel` for new content, omitted themes and legacy `classic` input. It still rejects unsupported/malformed values. This is normalization inside existing Story JSON; it adds no schema field or migration. The matching frontend removes the theme chooser and renders legacy published content/exports in Pastel without writing on preview. Unit and real persistence/private-public integration expectations were updated in the existing gate. No backend checks were run for this follow-up request; prior passing results predate this change. See `../birthday-celebration/docs/story-style-implementation.md`.

## October 17 optional original prices

The additive pricing schema adds independent optional originals for Standard
Premium and Birthday Story in INR/USD, without defaults or a stored percentage.
`tests/premium-pricing.test.js` covers usable/missing/malformed comparisons and
unchanged current charges. `tests/payment-regression.test.js` covers exact
quote currency/amount comparisons, permissions and pending Story amounts.
The existing `scripts/test-birthday-story.cjs` integration and new
`tests/helpers/premium-pricing-regression.cjs`, called by the HTTP regression
helper, cover real schema persistence/clearing, overprecision suppression,
both product/currency API shapes and Story order pricing. The launcher/server
suite covers the mock-only pricing control described above.

Matching frontend coverage includes `tests/e2e/discount-pricing-api.spec.ts`
for a visitor abroad receiving the saved Standard INR quote without owner-ID
leakage or new guest permissions; `tests/stack/payments.spec.ts` checks the
same saved-country quote against a real order. `tests/stack/pricing.spec.ts`
checks real CMS edits, both public product offers, authenticated price-cache
revalidation and no provider side effects. The
[frontend handoff](../../birthday-celebration/docs/2026-10-17-configurable-pricing.md)
lists the remaining helper/browser coverage and NAV-03/PRICE-01–14 cases.

**No tests, builds or other verification commands were run for this October 17
request.** Existing run results apply to their recorded snapshots. See
[pricing setup](pricing.md) for backend-first deployment, Save without Publish,
optional-original fallback and the shared revalidation workflow.


## October 30 EU readiness

See the frontend `docs/2026-10-30-eu-readiness-implementation.md` for the cross-repository contract, coverage, deployment order and unresolved provider/business evidence. Retention and consent coverage is wired into the existing gates; later removals deleted custom intake, early-delivery requirements and self-service celebration erasure. No test, build, typecheck, lint or browser verification commands were run for this implementation request.


## October 30 one-year retention follow-up

The owner changed private celebration retention to one calendar year after the original public-window end; never-published checkout drafts use original creation. Reminder emails are deferred. Calendar/boundary/migration/retry unit coverage, persisted backend/HTTP coverage, frontend fixtures/dashboard and real-stack assertions were updated. See `../birthday-celebration/docs/2026-10-30-one-year-celebration-retention.md` and DASH-06/07, LIFE-03/07–11. No tests or verification commands were executed for this source change; execution was not requested.


## October 30 removal of policy, request and early-delivery additions

At the owner's explicit request, removed seller/EU policy additions and Shopify policy artifacts, custom request pages/APIs/Strapi collection/receipts, and early-delivery acknowledgment/contract confirmation. Existing main-site policies retain the separately requested one-year retention and cookie-choice wording. Scheduled cleanup and optional tracking controls remain; self-service celebration erasure was removed in the October 31 follow-up.

Original checkout payloads and existing regression callers are restored. Added/updated coverage describes no-checkbox checkout, new-order persistence/idempotency without acknowledgment fields, unavailable request APIs, absent footer links, and preserved ownership/cleanup guards (EU-06–08, PAY-03/07/15, DASH-06/07, LIFE-03/07–11). Tests for removed behavior were updated intentionally. Existing gates discover the remaining cases.

No tests, typechecks, lint, builds, browser/stack or media checks were run. Execution was not requested. No deployment, production database/schema changes, emails or payment calls were performed. Remaining runtime checks require a separate testing request.

## October 30 countdown guest wishes

`POST /api/celebration-wishes/:slug` uses the existing internal API-token policy
and payment-server permission scope. It saves wishes on published Standard and
paid published Story celebrations, both before and after opening. Names must be
trimmed strings of 1–100 characters; messages must be 4–2000 characters. Missing,
unpublished, paused, expired, unpaid Story and erasure-pending entries return
404; the Elena Story demo returns 403. The existing Story wish endpoint stays
Story-only and delegates to the same append service.

The append transaction locks the published row, rechecks availability and then
updates only wishes and modification timestamps on both draft and published
copies. This keeps creator edits private and preserves wishes when those edits
are later published. Before opening the response includes only the newly saved
wish. Live responses also include the wish list. This does not extend expiry or
private retention and adds no schema field or migration.

Coverage was added to `tests/celebration-wishes.test.js`, the real HTTP helper
`tests/helpers/celebration-wishes-regression.cjs` called by the existing HTTP
suite, and the paid Story persistence flow in `scripts/test-birthday-story.cjs`.
The disposable launcher schedule control and its authorization/validation/wish
persistence cases are covered in `scripts/test-regression-server.cjs`; it is
never registered by normal Strapi startup. Existing gates discover these cases.
Frontend API/fixture/browser/real-stack coverage accompanies this contract.

No tests, builds, lint, typechecks or other verification commands were run for
this request. PostgreSQL lock/concurrency behavior still needs a disposable
PostgreSQL or staging check when testing is requested; SQLite and mocked
transactions do not prove production locking. Deploy this backend route before
the frontend countdown form and new Next.js wish proxy.
