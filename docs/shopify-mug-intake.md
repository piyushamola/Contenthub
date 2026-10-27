# Shopify personalized mug intake

The full contract and production release plan are in
[shopify-production-handoff.md](shopify-production-handoff.md).

Intake defaults off. The Next `POST /api/shopify/mug-orders` verifies the raw-body
Shopify app signature, shop and topic, then relays to Contenthub's private
`POST /api/shopify-mug-orders/intake`. A persistent receipt is acknowledged only
after the row-locked database transaction commits. Cancellation/refund stops are
sticky; later removal records an ordering tombstone. A failed capture is retryable.

Merchant inspection/approval happens through authenticated `/admin/mugs`, with
Next `/api/merchant/mugs` and the restricted Contenthub `.review` action. Customer
cart flags and manually changing `reviewDecision` in Strapi Content Manager are
not production approval. Only the explicit merchant approval operation binds
current order revision and immutable saved artwork/preview and creates durable jobs.

Production work uses the separate restricted `.work` action and Next
`POST /api/internal/mug-production/run`. It is default-off and independently gated
by both services' live flag, exact first-order allowlist, native-exclusion evidence
and print-contract confirmation. A job records intent before its single provider
POST; uncertain outcomes reconcile the same reference. Review never directly
calls Qikink or collects payment.

Use three separate Custom Content API tokens, exactly one action per token:
`api::shopify-mug-order.shopify-mug-order.intake`, `.review`, `.work`, plus the shared
32–256-character relay secret. No anonymous or ordinary JWT access is granted.
Product/shop/variant IDs are explicit. See the handoff for the required private
variables, scope list, lifecycle fields, merchant IDs, encryption/signing keys,
provider account identity, worker schedule, release blockers and deletion policy.

Coverage is wired into the existing gates. Units, real Strapi HTTP/database,
SQLite/PostgreSQL job/claim/rollback checks and real Next-to-Strapi browser checks
use synthetic data and provider doubles. Actual results are in
[test-runs/2026-10-27-mug-production.md](test-runs/2026-10-27-mug-production.md).
No live order, payment, Shopify configuration, deployment or enablement was
performed by those checks.
