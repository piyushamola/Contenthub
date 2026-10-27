# Personalized-mug implementation and test report — 2026-10-27

## Scope and repository state

Implemented the Shopify → Next.js → Contenthub merchant review → durable job →
Qikink live adapter → exact Shopify line fulfillment workflow. This is repository
code, not a deployed or live-certified integration. Intake and submission default
off. No live credentials were printed, no customer images were used, and no real
Shopify/provider writes, payments, webhook registrations or permission changes
were performed.

Both checkouts use branch `codex/shopify-mug-production` in their original folders.
Frontend baseline: `99f8bdbfef93cd2b98f69c3860693da9055b1722`.
Contenthub baseline: `251d8a396e9aca0ece0ab1f336e6140461d36129`.
The local PR #16 source was inspected; the branch was not fetched again. Its
sandbox foundation was retained separately. The earlier Contenthub intake code
was reviewed and extended; no patch was applied twice. The unrelated existing
75-line addition in Contenthub `types/generated/contentTypes.d.ts` is excluded.
No push, PR creation or PR comment is performed, following the user's instruction.

## What changed

- Signed, bounded Shopify webhook intake with explicit shop/product/variant,
  cart properties, INR/₹349 quantity, amount, discount and delivery validation.
- Private Strapi order/receipt collections, transaction-bound capture, persistent
  duplicate protection, revision invalidation and cancellation/refund/removal holds.
- Authenticated allowlisted application-admin review at `/admin/mugs`; separate
  restricted intake/review/worker tokens plus the relay secret. Ordinary JWTs and
  broad tokens cannot call the private backend actions.
- Actual PNG/JPEG decode, exact 2550 × 1050 artwork validation, encrypted immutable
  image bytes and hashes. Approval binds both images and the current revision.
  The merchant checks the photo/preview match, front layout and blank reverse;
  pixel dimensions alone do not establish those visual facts.
- Durable jobs, atomic leases, persisted submission and fulfillment intent,
  fixed references, uncertain-result reconciliation and no blind write retries.
- A separate fixed-origin live adapter using Qikink's documented image URL fields.
  Every personalized line receives a distinct provider job/design identity.
- Current Shopify payment/refund/cancellation/content/location checks, strict
  returned provider details and exact fulfillment-order line selection.
- Local privacy erasure, replay protection and explicit external deletion alerts.
  Thirty-day artifact expiry restricts access; it does not physically purge backups
  or orphaned staging blobs. Release requires a retention/cleanup policy.
- Default-off live flag, first-order allowlist, native-import and print-contract
  gates in both services. Keys alone cannot enable production writes.

## Environment and test safety

All commands used Node **22.23.4**, dummy credentials and synthetic order/image
fixtures. Backend tests use disposable SQLite or disposable local PostgreSQL
**16.10** with network guards. External write adapters are stubbed. Browser stack
checks use the existing isolated Next/Strapi runner and secure-cookie behavior.
No Razorpay sandbox or Qikink live/sandbox order was created by these tests.

## Final successful checks

| Repository | Command | Result |
| --- | --- | --- |
| Frontend | `npm run test:unit` | **339 passed, 0 failed, 0 skipped** |
| Frontend | `npm run typecheck` | Passed; normal and isolated route types plus TypeScript |
| Frontend | `npm run test:e2e -- tests/e2e/mug-production-api.spec.ts --project=api` | **1 passed**, including isolated Next production build |
| Frontend | `npm run test:stack -- tests/stack/mug-production.spec.ts` | **3 passed**: Chromium, mobile Chromium, WebKit |
| Frontend | `npm run test:stack -- tests/stack/mug-production.spec.ts --project=webkit` | **1 passed** after adding signed-image byte/hash and tampered-signature checks |
| Contenthub | `npm run check` | **Passed**: 153 unit tests, all SQLite HTTP/database and existing regression suites, disposable-server checks and Strapi admin build |
| Contenthub | `npm run test:mug:postgres` | Passed: **12 intake HTTP/database groups**, production approval/atomic-claim/crash recovery and physical image-erasure assertions |

The real cross-app test covers signed paid intake, durable storage, ordinary-user
rejection, merchant review, real image decoding, approval/job persistence,
default-off worker and cancellation hold. The expanded WebKit run additionally
compares the public signed download to the saved image digest and rejects a bad
signature. It performs no provider submission.

PostgreSQL concurrency **was tested**: simultaneous first deliveries persist one
order/receipt; competing worker claims yield one winner. Both database variants
also cover duplicate approval by different merchants, approval revocation,
provider-intent crash recovery, failed outcome persistence, late result capture,
post-intent edits and image erasure after revision changes.

Relevant frontend case IDs: `POD-07` through `POD-14` in `WEBSITE-TEST-CASES.md`.
The full frontend media suite and all unrelated browser journeys were not run.
The backend full gate covers existing celebration, pricing, ownership, payment,
refund, expiry and server behavior with synthetic provider responses.

## Failures found and resolved

- Malformed/ambiguous provider success and unsafe numeric order IDs must remain
  uncertain; regression coverage now prevents false success or blind retry.
- Numeric authentication ClientId values are normalized before identity checking.
- Approval identity originally depended on the merchant; approving the same design
  with another authorized admin now reuses its durable job.
- Underpaid totals and missing/non-INR presentment currency now fail validation.
- An ISO-string lease comparison could reclaim active SQLite leases. Date-bound
  SQL comparisons now retain one claimant; PostgreSQL also passes.
- Source edits cleared the current artifact index, leaving old image blobs after
  erasure. Erasure now collects hashes from frozen job approvals as well; real
  SQLite and PostgreSQL assertions require zero remaining unshared blobs.
- An isolated HTTPS callback port was rejected by the webhook SDK. Only the
  regression-build localhost allowance was adjusted; production port checks remain.
- A nullable access-token type was corrected; final typechecking passes.

Some earlier broad runs timed out during unit execution, PostgreSQL initialization
or Strapi admin build. Those attempts were not counted as passing. Focused checks
and the final runs were executed without weakening tests, increasing retries or
changing timeout limits. See the final backend gate result below.

## External release blockers

1. Obtain and verify the parent Shopify product ID, installed app grant/scopes,
   protected customer data access and merchant-managed location.
2. Prove native Qikink import exclusion for this SKU without affecting T-shirts.
3. Confirm live SKU/method/print axes/front/reverse with Qikink. Earlier sandbox
   output reversed the axes; this implementation blocks unexpected live details.
4. Confirm total provider costs, shipping per personalized line and wallet budget.
5. Approve deployment, private environment configuration and worker scheduling.
6. Establish retention/orphan cleanup/backup deletion and cancellation procedures.
7. Authorize the exact first paid order separately. No real provider contract,
   fulfillment/tracking write or physical sample was exercised in this task.

Manual exceptions remain: late cancellation/refund after an external POST,
provider cancellation and changing tracking after Shopify fulfillment. These
hold or require operator action rather than making speculative writes. Empty
Qikink search results after uncertain submission never authorize resubmission.

See [the production handoff](../shopify-production-handoff.md) for all private
variable names, token permissions, operator actions, deployment order and the
future final paid-submission checkpoint.

## Final backend gate result

`npm run check` completed with exit code **0** after the final fixes. It reported
153 unit passes, 0 failures/skips, all real SQLite integration/server checks, and
a successful Strapi admin build (32.064 seconds). The PostgreSQL focused gate also
completed with exit code **0**. Earlier timed-out attempts remain failed attempts.
