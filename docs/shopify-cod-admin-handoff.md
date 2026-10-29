# COD and private POD order administration

## What is supported

Next.js verifies raw Shopify webhook bodies, saves one Contenthub record per
shop/order, then uses the existing leased worker to submit/reconcile Qikink.
Strapi **5.54.0** has a dedicated **POD orders** admin plugin. The existing
`pod_orders` table remains the fulfillment source of truth. It stays hidden from
Content Manager; raw Content Manager access to POD records/audits is blocked.

### Payment rules

- Paid orders with zero outstanding remain prepaid, even if their original
  gateway was COD. Unpaid prepaid orders wait for a paid webhook.
- COD requires the actual Shopify `payment_gateway_names` / Admin API
  `paymentGatewayNames` to contain exactly the standard **Cash on Delivery (COD)**
  gateway, ignoring case/outer whitespace. Arbitrary pending/manual/bank-transfer
  orders are not classified as COD. Renamed/custom gateways need a reviewed mapping.
- Only pending, wholly unpaid COD orders are eligible. The full outstanding
  amount must equal the current order total. Partial payments, combined gateways,
  unsupported extra charges and mixed carts are held, with a reason.
- Every COD line must belong to this connector. No Qikink collection is allocated
  to products fulfilled elsewhere. Prepaid mixed carts keep their existing behavior.
- Arithmetic uses integer paise. Discounted line subtotals must reconcile with
  Shopify's subtotal; shipping and tax must reconcile with the grand total.
  Included tax is not added twice. Missing required amounts block COD.
- Qikink receives `gateway: "COD"`, `qikink_shipping: "1"`, and the entire
  collectible amount in `total_order_value`. No invented separate shipping/COD
  fee parameter is sent. Provider reads verify payment type/value before tracking
  can fulfill Shopify lines. No payment/wallet mutation is added.

The current [official Qikink collection](https://documenter.getpostman.com/view/26157218/2sBYAysUHS)
was fetched on October 29, 2026 from its public
[collection JSON](https://documenter.gw.postman.com/api/collections/26157218/2sBYAysUHS?segregateAuth=true&versionTag=latest).
It documents the case-sensitive COD/Prepaid gateway, retail order value, shipment
flag, current creation endpoint and provider payment type. The old ERP API's
`cash_on_delivery` contract is not used.

Vendor checks still required before a real sample: confirm this account's COD
availability/serviceable destination and the complete merchant shipping/COD
charges; confirm the courier collects exactly the submitted retail value without
an additional customer surcharge. The API documentation is not a cost quote or
proof of actual collection/settlement. Existing mug print-template checks remain.

## Shopify configuration

Manually maintain **five JSON subscriptions**, API version **2026-10**:

```text
orders/create
orders/paid
orders/updated
orders/cancelled
refunds/create
```

Callback: **POST `https://www.wishhappybdayto.me/api/shopify/pod-orders`** (or the
actual deployed Next.js origin). Add `orders/create` to the existing four; do not
duplicate existing subscriptions. This code never registers subscriptions.

Keep payment gateway names, order name/ID, update time, currency, financial
status, outstanding balance, current total/subtotal/discount/tax, tax-included
flag, shipping money/currency, refunds/cancellation, shipping/contact details and
all line properties in the webhook. Do not filter away stop events. The fresh
Shopify read uses the corresponding current money sets and gateway names.

Existing Shopify scopes/protected shipping/contact access remain required.
Native Qikink import must exclude these custom variants, and their fulfillment
orders must belong to the configured merchant-managed location. Product mapping,
image-host restrictions and pixel/placement checks remain in place.

## Environment and deployment

**No additional environment variable is introduced for COD or admin actions.**
Existing Next.js settings remain: Shopify shop/app URL and credentials,
`SHOPIFY_WEBHOOK_SECRET` from Notifications, authentication mode/location,
`CMS_URL`, restricted `POD_CMS_TOKEN`, shared `POD_RELAY_SECRET`,
`POD_WORKER_SECRET`, `POD_ASSET_HOSTS`, and Qikink live client credentials.
`QIKINK_LIVE_ACCOUNT_ID` is optional; `POD_ALLOWED_ORDER_IDS` is unused.

During deployment:

```dotenv
SHOPIFY_POD_ENABLED=false
QIKINK_LIVE_ENABLED=false
```

Contenthub retains its existing database configuration and `POD_RELAY_SECRET`.
The relay token still has exactly `api::pod-order.pod-order.state`; public and
ordinary Content API roles receive no POD permission. App credentials authenticate
outbound Shopify calls; the separate webhook key verifies incoming deliveries.

1. Back up the database. Keep provider submission off and stop worker invocations.
2. Deploy Contenthub first, including the new admin bundle/plugin and additive
   schema. Add columns/states and the private audit table; never drop/recreate
   `pod_orders` or regenerate existing references/provider history.
3. Bootstrap fills nullable display/payment columns in batches. Historical
   snapshots remain untouched, and reads support old prepaid snapshots. This is
   repeatable; populated metadata is not overwritten. Metadata backfill can update
   the record's updated time. IDs, creation time, state, leases and intent survive.
4. Assign admin RBAC permissions deliberately in production. No production
   permissions were changed by this implementation.
5. Deploy Next.js, confirm configuration/mapping and the five subscriptions.
6. Enable intake separately while provider processing remains off.

Rollback: disable live processing/intake as needed and stop worker calls. Retain
new columns, audit rows and all paused/validating/intent/reference/provider data.
An old backend cannot operate the new admin workflow; do not reset paused or
uncertain records to force an old worker to submit.

## Admin usage and permissions

Open **Strapi Admin → POD orders**. Search by order number/ID/provider ID, page
through records, and filter by state, payment mode or created date (UTC dates).
The list shows order value/collectible amount, times, state, provider ID/status,
AWB, issues/reason and internal notes. Open an order for supported actions.

Grant independently:

- `plugin::pod-orders.read`: view/search/detail and audit history.
- `plugin::pod-orders.notes`: edit notes, together with read access.
- `plugin::pod-orders.operate`: pause/resume/correct, together with read access.

All changes require a reason and the current revision. Concurrent stale actions
return 409. Notes may be edited after submission; fulfillment inputs may not.
Erased records cannot be repopulated with notes.

**Pause:** available before intent on queued/validating orders. It clears the
worker lease atomically. A worker whose lease was revoked cannot save intent or
POST a provider order. Once intent wins the lock, pause/corrections are rejected.

**Correction:** only the final artwork/preview URLs for an existing line and
placement can be overridden. Product, variant, quantities, print specifications,
destination, payment and totals remain authoritative in Shopify/configuration.
For those changes, use the provided Shopify link and receive an updated webhook.
Invalid source-order issues must be fixed there. A correction pauses the order
and binds the override to its saved Shopify revision.

**Resume:** moves an otherwise eligible paused order to **validating**, not
straight to submission. The worker verifies trusted hosts, actual image bytes
and configured dimensions, fresh Shopify financial/content state, and exact
fulfillment ownership. Only then does a durable `ready` transition queue it.
Submission performs those checks again and records intent before one POST.
Source edits revoke stale validation/corrections. Cancellation/refund stops
remain permanent; edits after intent require investigation/reconciliation.

Each admin change records actor ID, timestamp, action, reason and appropriate
before/after state or hashes/lengths for notes/links in `pod_order_audits`, in the
same transaction. Audit failure rolls back the action. No customer addresses,
full note copies, private artwork URLs or credentials are copied to audit data.
Restrict database/backups; set audit and note retention. Existing privacy erase
also clears overrides/notes, retaining minimal duplicate/submission history.

## Manual worker and later live sample

A scheduler remains optional. Authenticated **POST `/api/internal/pod/run`**
processes one eligible queued/validating/submitted record. With
`QIKINK_LIVE_ENABLED=false`, it performs no live processing, including validation.
GET of that path with `?orderId=NUMERIC_ID` and the same worker Bearer token reads
redacted state only. Manually run POST later to poll/reconcile tracking.

Before a later real test, inspect all pending records and vendor costs. There is
no per-order allowlist: enabling live processing makes all eligible queued orders
available. Obtain authorization to spend, enable deliberately, check the saved
provider ID/payment type/value and exact fulfillment lines, then disable while
reviewing the sample. Timeout/uncertain POST outcomes reconcile the same reference;
never delete history or change a reference to force retry. Existing accepted
provider orders need manual vendor cancellation/refund handling.

## Validation

See the companion October 29 COD/admin test report for exact final results and
the initial test failures. Tests use synthetic data, disposable SQLite/PostgreSQL
and fake provider writes. No live order, payment, deployment or production
permission/subscription change is part of this implementation.
