# Shopify personalized-mug production handoff

Status: repository implementation; **not deployed or enabled**. Shopify/store/theme,
products, shipping and subscriptions were not changed. No live Qikink order,
payment, wallet debit or production permission change was performed.

## 1. Callback and topics

Planned production callback: **POST
`https://www.wishhappybdayto.me/api/shopify/mug-orders`**. The exact implemented
path is `/api/shopify/mug-orders`; `SHOPIFY_MUG_APP_URL` must match the actual
Next deployment. This document does not claim that the new route is deployed.
The MCP operator must verify it after the separately approved deployment before
registering subscriptions. API version: **2026-10**.

Use app-owned `orders/paid`, `orders/updated`, `orders/cancelled`, `refunds/create`.
Next verifies the raw-body Shopify HMAC with the official SDK before parsing.
The maximum signed body is 512 KiB. Disabled intake returns 503. Only a committed
Contenthub receipt returns `{"received":true}`. Storage failure is retryable;
Shopify delivery failure monitoring and missed-event reconciliation remain required.

## 2. App authentication and scopes

Use a dedicated Shopify app for this merchant. Its app **client secret** signs
app-owned webhook deliveries. Do not use a Storefront token, a Qikink key, or
an unrelated manually configured admin-webhook signing secret.

Preferred server model for an app/store in the same Shopify organization:
`SHOPIFY_MUG_AUTH_MODE=client_credentials`. The Next adapter exchanges the app's
client ID/secret at `/admin/oauth/access_token`, keeps the returned access token
within the worker invocation, and uses `X-Shopify-Access-Token` for GraphQL.
The operator must confirm this grant is eligible for the chosen app/store.

Alternatively `SHOPIFY_MUG_AUTH_MODE=offline_token` uses an existing, privately
provisioned `SHOPIFY_MUG_ADMIN_ACCESS_TOKEN`. The operator owns renewal/revocation.
This implementation does not implement an OAuth browser installation or refresh
flow for expiring offline tokens. Do not configure an expiring token without a
renewal mechanism. Auth failures defer work; they do not permit blind writes.

Required app capabilities: `read_orders`, `read_products`, `read_locations`,
`read_merchant_managed_fulfillment_orders`,
`write_merchant_managed_fulfillment_orders`. Confirm these against the installed
app and grant only the required data access. The app must be authorized to receive
and read the necessary protected customer shipping/contact data. Redacted/missing
fields block submission. `read_all_orders` is not assumed; old unresolved orders
outside granted history require manual investigation and must never be recreated.

References: [client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant),
[token lifetimes](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens),
[webhook verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries),
[fulfillmentCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/fulfillmentCreate).

## 3. Payload fields and filtering

For paid/update snapshots retain: `id`, `name`, `updated_at`, `test`,
`financial_status`, `currency`, `presentment_currency`, `total_price`,
`total_discounts`, `total_outstanding`, `cancelled_at`, `refunds`, `email` /
`contact_email`, `phone`, `shipping_address`, and `line_items`.

Shipping needs first/last name, address1/address2, city, province, zip,
country_code and phone. Lines need `id`, `product_id`, `variant_id`, `sku`,
`quantity`, `price`, `total_discount`, `fulfillment_status`,
`fulfillable_quantity` and all personalization `properties` entries.
Refund events need the refund/order identities (`id`, `order_id`);
cancellation needs `id` and `cancelled_at`. Do not filter away stop events or
updates that remove the last mug. Topic/property filtering must preserve the
whole lifecycle; use the backend's product checks rather than dropping such events.

Unknown products never become mug lines. Mixed-cart refunds conservatively hold
the mug workflow for the whole order. Orders/lines outside supported bounds,
wrong identity, discounts, non-INR, non-India shipping or unverified payment are
rejected or held. The latest authoritative Shopify read is checked again before
submission; client properties are not production approval.

## 4. Product, variant, pricing and cart contract

Documentation from frontend PR #16 records shop `h0i4dt-kz.myshopify.com`,
variant **50934024241209**, Shopify SKU **WHB-CUSTOM-MUG-11OZ**. These identifiers
were not read from or changed on the live store in this task. The parent product
ID is **not present in the available repository documentation**. The operator
must supply and verify it. Both services require explicit
`SHOPIFY_MUG_PRODUCT_ID` and `SHOPIFY_MUG_VARIANT_ID`; there is no accept-any fallback.

Preserve these property names and values exactly:

| Property | Contract |
| --- | --- |
| Print artwork | HTTPS flat print image on an explicitly trusted host |
| Approved preview | HTTPS preview on an explicitly trusted host |
| Message | Customer text, at most 45 characters |
| Design ID | Customer design identifier; retained as evidence, not used as provider identity |
| Design approved | Yes |
| Print placement | Front only |
| _whb_personalized | mug-front-v1 |

Retail: **₹349 per mug**, INR, India delivery, quantity 1–100. Discounts require
review and cannot pass the live worker. Actual order totals, paid/refund state,
product/variant, quantities and delivery are rechecked through Shopify GraphQL.
The provider SKU is **UWCM-Wh-11 OZ**, Accessories print method **5**, Front
placement `fr`, intended canvas **8.5 × 3.5 inches / 2550 × 1050 pixels**.

The old sandbox read returned reversed print axes. Live physical/template/method
behavior is not certified by that response. `MUG_PRINT_CONTRACT_VERIFIED` stays
false until the merchant obtains authoritative confirmation. No automatic
swapping of dimensions or assumed blank reverse is implemented.

A separate provider job/order is created for each approved personalized line;
quantity stays on that line. This supports different designs and avoids changing
unrelated items. **Multiple personalized lines can incur multiple provider
shipping charges.** The Qikink shipment retail value is ₹349 × that line's quantity,
not the mixed-cart total. These are retail declarations, not a fulfillment-cost
quote. The first-order budget/checkpoint must include production, GST and each
shipment's shipping charges; no undocumented cost API is assumed.

## 5. Prevent native Shopify–Qikink double fulfillment

An app checkbox is not sufficient evidence. Before release, the operator must:

- Identify every existing Qikink/native/Flow/other fulfillment import path for this
  SKU and variant. Arrange a vendor-supported exclusion of this personalized SKU
  from native import/production, without disrupting T-shirts.
- Route its fulfillment orders to an exclusive merchant-managed location and
  verify that the app sees the exact configured location. The worker checks
  location ID, manual/no third-party service, OPEN/UNSUBMITTED state and supported
  create-fulfillment action. Wrong/native locations block the job.
- Provide auditable evidence that a controlled order cannot enter both paths.
  If SKU-level native exclusion is unavailable, stop and agree an isolation design
  with Qikink; do not disable unrelated product fulfillment speculatively.
- Only then set `MUG_NATIVE_DUPLICATION_VERIFIED=true` and record the evidence ID
  in `MUG_NATIVE_DUPLICATION_EVIDENCE` in both services.

That attestation plus runtime location checks is a release requirement. Repository
code cannot prove how a separate native app imports merchant orders.

## 6. Exact actions for the Shopify MCP operator

The other conversation owns these changes; Codex did not perform them:

1. Confirm app/store ownership, authentication grant, scopes and protected data access.
2. Read and report the actual parent product ID and verify variant/SKU, ₹349 INR,
   India-only delivery, quantity limits, discounts and the existing property contract.
3. Keep the existing photo/text/customizer and T-shirt behavior. Ensure it supplies
   a genuine flat artwork URL, not an image of a cup or an enlarged low-resolution
   preview. Preserve the original photo aspect ratio and approved front-only layout.
4. Establish native import exclusion and merchant-managed fulfillment routing as above.
5. After backend-first deployment is separately approved and both callbacks are
   configured, register exactly the four app-owned subscriptions at the callback
   in section 1, using API version 2026-10. Do not create duplicate subscriptions.
6. Leave public mug purchasing and live submission off until the final paid checkpoint.
7. Coordinate missed-delivery, erasure and provider-cancellation operating procedures.

## 7. Private environment variables

All values below are placeholders/server-only. Never use NEXT_PUBLIC variables
for credentials. Never paste environment files, access tokens or signed image URLs
into PRs, logs, tickets or the handoff conversation.

### Next.js

```dotenv
SHOPIFY_MUG_INTAKE_ENABLED=false
SHOPIFY_MUG_SHOP_DOMAIN=VERIFIED_SHOP.myshopify.com
SHOPIFY_MUG_PRODUCT_ID=VERIFIED_PARENT_PRODUCT_ID
SHOPIFY_MUG_VARIANT_ID=VERIFIED_VARIANT_ID
SHOPIFY_MUG_ASSET_HOSTS=cdn.shopify.com,OTHER_EXACT_TRUSTED_IMAGE_HOST
SHOPIFY_MUG_APP_URL=https://www.wishhappybdayto.me
SHOPIFY_APP_CLIENT_ID=PRIVATE_SHOPIFY_APP_CLIENT_ID
SHOPIFY_APP_CLIENT_SECRET=PRIVATE_APP_SECRET_AND_WEBHOOK_SIGNING_SECRET
SHOPIFY_MUG_AUTH_MODE=client_credentials
# Only for the alternative existing offline-token model:
SHOPIFY_MUG_ADMIN_ACCESS_TOKEN=PRIVATE_OFFLINE_TOKEN_IF_SELECTED
CMS_URL=HTTPS_CONTENTHUB_ORIGIN
SHOPIFY_MUG_CMS_TOKEN=CUSTOM_INTAKE_ONLY_STRAPI_TOKEN
MUG_REVIEW_CMS_TOKEN=CUSTOM_REVIEW_ONLY_STRAPI_TOKEN
MUG_WORKER_CMS_TOKEN=CUSTOM_WORK_ONLY_STRAPI_TOKEN
SHOPIFY_MUG_RELAY_SECRET=PRIVATE_RANDOM_32_TO_256_CHARACTERS
SHOPIFY_MUG_MERCHANT_IDS=VERIFIED_APP_ADMIN_USER_IDS_COMMA_SEPARATED
MUG_WORKER_SECRET=PRIVATE_RANDOM_AT_LEAST_32_CHARACTERS
MUG_PROVIDER_ASSET_ORIGIN=https://www.wishhappybdayto.me
MUG_ASSET_SIGNING_SECRET=PRIVATE_RANDOM_AT_LEAST_32_CHARACTERS
QIKINK_LIVE_CLIENT_ID=PRIVATE_LIVE_CLIENT_ID
QIKINK_LIVE_SECRET=PRIVATE_LIVE_SECRET
QIKINK_LIVE_ACCOUNT_ID=SEPARATELY_CONFIRMED_NUMERIC_ORDER_PREFIX
MUG_SHOPIFY_LOCATION_ID=gid://shopify/Location/VERIFIED_MERCHANT_LOCATION
MUG_LIVE_SUBMISSION_ENABLED=false
MUG_FIRST_ORDER_ALLOWLIST=
MUG_NATIVE_DUPLICATION_VERIFIED=false
MUG_NATIVE_DUPLICATION_EVIDENCE=
MUG_PRINT_CONTRACT_VERIFIED=false
```

`QIKINK_LIVE_ACCOUNT_ID` is not inferred from API ClientId. Sandbox variables and
fixed sandbox adapter remain separate. Live keys alone cannot enable submission.

### Contenthub

```dotenv
SHOPIFY_MUG_INTAKE_ENABLED=false
SHOPIFY_MUG_SHOP_DOMAIN=SAME_VERIFIED_SHOP.myshopify.com
SHOPIFY_MUG_PRODUCT_ID=SAME_VERIFIED_PARENT_PRODUCT_ID
SHOPIFY_MUG_VARIANT_ID=SAME_VERIFIED_VARIANT_ID
SHOPIFY_MUG_ASSET_HOSTS=SAME_EXACT_TRUSTED_HOSTS
SHOPIFY_MUG_RELAY_SECRET=SAME_PRIVATE_SHARED_SECRET
SHOPIFY_MUG_MERCHANT_IDS=SAME_VERIFIED_MERCHANT_USER_IDS
MUG_ARTIFACT_ENCRYPTION_KEY=PRIVATE_64_HEX_CHARACTERS_32_BYTE_AES_KEY
MUG_LIVE_SUBMISSION_ENABLED=false
MUG_FIRST_ORDER_ALLOWLIST=
MUG_NATIVE_DUPLICATION_VERIFIED=false
MUG_NATIVE_DUPLICATION_EVIDENCE=
MUG_PRINT_CONTRACT_VERIFIED=false
```

Create three **Custom Content API** tokens, each with exactly one action:
`api::shopify-mug-order.shopify-mug-order.intake`, `.review`, or `.work`.
The corresponding Next variable uses that token. Full-access/read-only tokens,
ordinary user JWTs and extra-action tokens are rejected. The shared secret is also
required. Normal users and Public get no new permissions. Merchant review also
requires an authenticated current Next admin user whose server-derived ID is in
the configured allowlist. These are users-permissions application user IDs with the
existing application Admin role, not `admin::user` IDs from the Strapi administration
panel. No production permissions were changed by this work.

## 8. Deployment, scheduling, rollback and kill switch

1. Review both branches, backups, privacy policy and passing checks. Deploy the
   additive Contenthub schemas/private routes first with flags false. Keep its
   existing unrelated generated-type changes separate from this implementation.
2. Configure secrets, token scopes, exact product/shop/location IDs and merchant
   IDs privately. Deploy Next with flags false. Verify private `/admin/mugs`,
   auth/CSRF boundaries and disabled submission before enabling intake.
3. Enable intake only for a controlled test when deliberately authorized; register
   subscriptions through the MCP operator. Do not change the native path implicitly.
4. A scheduler calls **POST `/api/internal/mug-production/run`** with
   `Authorization: Bearer <MUG_WORKER_SECRET>` every minute. Each invocation handles
   at most one durable job. Parallel invocations use database leases/row locks;
   no in-memory queue, local journal or Vercel disk owns production state.
   The function budget is 120 seconds and a lease is 180 seconds. A crash after
   intent always enters reconciliation. Scheduler configuration is not installed
   or enabled by this branch.
5. Until the separately approved first paid checkpoint, keep live flags false and
   allowlists empty in **both** services. Kill writes immediately by setting
   `MUG_LIVE_SUBMISSION_ENABLED=false` in either/both and stopping the scheduler.
   This implementation also pauses worker polling/fulfillment while the live flag
   is false. Use deliberate controlled polling windows for already authorized jobs
   with the same narrow allowlist; never reset their attempt state.
   A POST already in flight might already exist at Qikink; reconcile it. A kill
   switch does not cancel a paid provider order.
6. Roll back application code with submission disabled. Keep durable order/job/
   receipt/artifact rows and provider IDs; never delete the attempt history or
   regenerate references to force a retry. Do not drop these additive tables as
   a routine rollback. Native import must remain excluded until ownership is clear.

### Submission and tracking behavior

Before its one provider POST, the worker checks the allowlist, native/print gates,
current approval/revision, immutable stored image hashes and current Shopify data.
It records intent/request digest before POST. A crash, timeout, unreadable success
or failed result persistence leaves intent/reconciliation. The same immutable
reference is looked up; an empty fixed-history Qikink list is **not** permission to
resubmit. Missing/ambiguous evidence remains for manual resolution.

Qikink reads use the documented `/api/order/list` by reference or saved order ID.
The worker verifies account/reference, SKU, quantity, design identity, dimensions,
Front placement and saved asset identity. It polls status and reads
`shipping.awb`, `shipping.tracking_link`, `shipping.courier_provider_name`.
Only supported shipment states with valid tracking can advance fulfillment.
Missing/reversed/unexpected provider data holds the job rather than guessing.

Shopify fulfillment always names exact fulfillment-order line IDs and quantities.
It never omits the line list or marks unrelated T-shirt lines fulfilled. Mutation
intent is saved first. An uncertain Shopify result is matched to the exact mug
quantity and AWB without another blind mutation. Existing fulfilled jobs continue
status polling. A changed AWB after fulfillment is held for operator correction;
automatic tracking replacement/cancellation is not implemented. Cancellation,
refund or edit after provider intent requires immediate manual provider follow-up;
there is no documented cancellation endpoint in the public collection used here.
Cross-system state can change between the final Shopify read and Qikink POST;
this cannot be made atomic with these two external APIs.

Qikink sources consulted: [official API collection](https://documenter.getpostman.com/view/26157218/2sBYAysUHS),
[print-file guidance](https://qikink.com/help/printing/how-to-prepare-print-files/),
[tracking guidance](https://qikink.com/help/orders/how-to-track-an-order/).
The collection lists token, order creation (printed/plain), list and legacy order
reads. It sends artwork through `design_link` and `mockup_link`; no separate
upload/cancellation/fulfillment-cost API was assumed.

### Privacy, retention and deletion

Order snapshots/contact are private Contenthub records; image bytes are stored
in the database encrypted with AES-256-GCM and keyed by SHA-256. Merchant image
reads require authentication; Qikink gets short-lived signed access to the exact
saved bytes (up to seven days), not a mutable original URL. Plain image links,
addresses, webhook bodies and provider errors are never intentionally logged.
Configure hosting/CDN logs to redact signed asset query strings and private API
payloads. Do not enable public caching/indexing of these routes. Configure database
backups/encryption/access control and protect the AES key; changing the key without
a migration makes existing artifacts unreadable.

Artifacts have a 30-day access deadline. Expiry is **not automatic physical
DB deletion**. Decide legal retention, reconciliation and backup deletion before
public launch. The authenticated merchant API supports `op=erase` with the current
revision and `confirmErase=true`: it holds jobs, scrubs this order's local contact/
design snapshots and deletes unshared image blobs. Minimal hashed identities,
source digest, receipt and provider IDs remain for duplicate/audit protection.
Subsequent webhooks cannot restore erased personal data. Shared blobs remain while
another order/job references them. Unreferenced staging blobs from failed image
preparation require a retention cleanup procedure; no automatic purge is enabled.
The result flags when Shopify/Qikink/CDN/backups need separate deletion. Erasure
is not provider cancellation; unresolved provider work needs an operator first.

## 9. First live order and final paid-submission checkpoint

This is a future procedure, not authorization granted by this implementation.

1. Resolve every blocker below. Confirm protected customer data, native exclusion,
   exact product/variant/location, print method/template and account prefix.
2. Validate one paid controlled Shopify order with **one** personalized line. Keep
   live submission false. Download/decode and save its actual artwork and preview
   through `/admin/mugs`. Confirm 2550 × 1050, source-photo quality/aspect ratio,
   approved visual match, front-only layout and blank reverse against the vendor
   template. The pixel dimensions alone cannot establish source quality.
3. Recheck paid INR amount, ₹349 quantity, zero discounts, shipping, refunds,
   cancellation and current fulfillment ownership. Merchant checks the three
   inspection confirmations and approves the exact saved revision/bytes.
4. Record expected complete provider cost and wallet charge, separate shipping per
   line, destination, SKU, quantity, design hashes/reference and rollback/contact plan.
5. **Final paid checkpoint:** obtain the human's explicit authorization to submit
   this exact order and spend its provider cost. Then set only its Shopify order
   ID in both first-order allowlists, set the native/print evidence gates and
   enable both live flags for that one run. Merely adding credentials is insufficient.
6. Reconcile the saved reference before another attempt if anything is uncertain.
   Retrieve the saved provider ID and compare all order/design fields. Validate
   tracking and exact Shopify line fulfillment. Disable the live flags afterward.
7. Do not enable public purchasing or a broad allowlist from one API success.
   A physical sample and explicit wider release remain separate decisions.

## 10. Blockers and verified checks

See [the production execution report](test-runs/2026-10-27-mug-production.md) for
commands, results and failed attempts. Tests use synthetic images/orders, dummy
credentials, isolated databases and mocked external providers; no real provider
write or Shopify configuration change occurs in automated checks.

Remaining external release requirements: confirmed parent product ID; live app
installation/auth/scopes and protected customer data; native-import exclusion
proof and merchant location; live SKU/method/axes/front/reverse confirmation;
actual provider cost/budget and explicit first paid authorization; deployment,
scheduler setup, retention/cleanup/backup policy and operator cancellation/deletion
procedures. The live Shopify/Qikink schema and shipment have not been exercised
against real credentials in this implementation task. Fail-closed fixtures cannot
prove those external facts. All production enablement remains off.
