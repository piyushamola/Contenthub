# Regression checks

Use Node 22 (the supported runtime in `package.json`) and npm. From this repository:

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

- Pricing conversion to payment units; new orders use current prices and existing orders keep the quoted price.
- Checkout ownership, valid purchase IDs, demo/expired/deleted celebrations, and reuse of another celebration's payment attempt.
- Payment signatures, provider capture status, order ownership, payment and order amount/currency checks.
- Duplicate captures, duplicate/retried webhooks, partial/full refunds, and preserving the original payment's entitlement.
- Capture after expiry/deletion records the payment for refund without restoring access or extending expiry.
- Owner/admin policies, private story routes, free/paid feature access, and the 24-hour legacy expiry fallback.
- Cleanup rechecks records before unpublishing, handles duplicate rows, and continues after a per-record failure.
- The existing story integration covers private drafts, owner isolation, upload duration/content limits, optimistic revision checks, paid publication, private edits versus published content, wishes, 24-hour expiry, migration idempotency, no republishing, concurrent checkout and recovery of interrupted checkout.
- Real HTTP requests cover password login, failed login, sanitized `/users/me`, dashboard routing and pagination, another user's empty dashboard, forbidden cross-owner pause, owner pause/resume, and authenticated API-token pricing/access response shapes.

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
| `GET /celebrations/:slug` | Real draft/published rows, related purchases, and retained image/story media; owner fields exclude password hashes |
| `POST /celebrations/:slug/expire` | Set expiry in the past and run the real unpublish cleanup |
| `GET /outbox?email=...` | Captured email content, including real registration/reset links |
| `GET /users?email=...` | User IDs, email, confirmation state, and role |
| `POST /payments/:orderId/capture` | Mock mode only: capture at the provider boundary and return a signed payment callback and webhook; the real verification/webhook route must still grant access |
| `POST /payments/:paymentId/refund` | Mock mode only: set refunded total and return a signed refund webhook for the real application to process |

Capture accepts optional `paymentId`, `amount`, and `currency` fields for negative verification cases. Refund accepts optional `amount`, defaulting to the full payment. Neither control directly grants or revokes application access. Their response includes `{eventId, webhook: {rawBody, signature}}`; capture also returns `{orderId, paymentId, signature}` for payment verification.

`--payments razorpay-test` preserves the real provider service. It requires explicitly passed `REGRESSION_RAZORPAY_KEY_ID` and `REGRESSION_RAZORPAY_KEY_SECRET`; a missing key, dummy key, or key without the `rzp_test_` prefix is rejected before Strapi boots. Only that mode permits outgoing connections to `api.razorpay.com`, and mock capture/refund controls return 409. Real provider test orders/payments remain in the provider's test dashboard; local shutdown does not delete remote provider history. Run this mode only as an explicitly authorized sandbox check. Ordinary `npm run check` remains offline and uses the provider mock.

## Adding features and fixing bugs

Follow the repository's [change and regression test rules](../AGENTS.md) for every change. They tell coding agents when to add tests, where to put them, and which checks to run before marking work complete.

Add a behavior test for each new feature and a regression test for each fixed bug. Put pure service/policy cases in `tests/*.test.js`; the runner discovers these files automatically. Add database relationships, constraints, publication, or migration cases to `scripts/test-birthday-story.cjs` or an integration suite wired into `scripts/run-check.cjs`. Add HTTP contract cases to `tests/helpers/http-regression.cjs`. Stub external providers at their network boundary and assert user-visible outcomes or persisted state. Run `npm run check` before opening the PR.

Do not delete or weaken a failed assertion just to get a green build. Decide whether the behavior change is intended; update the corresponding contract and tests together when it is. Keep the test database separate from development and production.

## Limits and existing warnings

No test suite can prove that every future change is safe. These checks cover the listed paths, not every CMS type or every input. SQLite cannot prove PostgreSQL-specific SQL, migration behavior, or production concurrency. Live Razorpay capture/refunds/webhooks, SMTP delivery, Google OAuth, browser rendering/media exports, and production infrastructure need separate provider sandbox/staging checks. The frontend has its own browser checks in its repository.

The current bootstrap attempts to seed old example article/category types and catches/logs some errors during a fresh database boot. The integration assertions pass after bootstrap; a green run does not certify this sample seed data. Strapi also currently warns about missing admin encryption configuration, and the local macOS Sharp installation can report duplicate libvips classes. These are existing application/dependency warnings, not suppressed by the test harness.
