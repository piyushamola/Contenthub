# Shopify → Qikink: simple production handoff

This replaces the earlier mug-only review workflow. **It is automatic and generic:**
Shopify paid order → Next.js → Qikink. Contenthub stores one private record per
Shopify order so retries cannot submit it twice. There is no merchant approval
screen, image-copy collection, per-design review job or fixed ₹349 price.

Nothing is deployed or enabled by this branch. No live order, payment, Shopify
configuration, subscription or production permission was changed.

## 1. Callback and topics

Implemented callback: **POST `/api/shopify/pod-orders`**.
Planned deployed URL: `https://www.wishhappybdayto.me/api/shopify/pod-orders`.
The route is not claimed to be deployed. Set `SHOPIFY_APP_URL` to its actual origin.

Shopify app-owned topics, API version **2026-10**:
`orders/paid`, `orders/updated`, `orders/cancelled`, `refunds/create`.
The official Shopify SDK verifies the raw-body HMAC before parsing. A successful
response contains only `{"received":true}` after durable capture. Failed storage
returns 503 for Shopify retry. Do not register both old and new callbacks.

## 2. Shopify app authentication

`SHOPIFY_APP_CLIENT_SECRET` is the signing secret of the app that owns these
subscriptions. A Storefront token or a different app's secret will not work.

Preferred model: `SHOPIFY_AUTH_MODE=client_credentials` for a merchant-owned app
eligible for Shopify's client-credentials grant. The worker obtains its Admin API
token privately. Otherwise use `SHOPIFY_AUTH_MODE=offline_token` and privately
provision `SHOPIFY_ADMIN_ACCESS_TOKEN`; renewal is the operator's responsibility.
This branch does not add an OAuth installation/refresh UI.

Required capabilities: `read_orders`, `read_products`, `read_locations`,
`read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`.
Obtain the required protected customer shipping/contact access. Missing/redacted
details block submission. Old orders beyond granted API history require manual
resolution; an unavailable read never authorizes another provider POST.

## 3. Required webhook data

Keep order `id`, `updated_at`, `test`, `financial_status`, `currency`,
`presentment_currency`, `total_price`, `total_outstanding`, `cancelled_at`, `refunds`,
`email`/`contact_email`, `phone`, `shipping_address`, and `line_items`.
Each line needs `id`, `variant_id`, `quantity`, `price`, `total_discount`,
`discount_allocations` (including `amount`), `fulfillable_quantity`,
`fulfillment_status`, `current_quantity` when present, and all `properties`.
Shipping needs name, address, city, province, PIN, country code and phone.
Refund events need `order_id`; cancellation events need `id`.

Do not filter out cancellation/refund events or updates removing the last custom
line. The maximum webhook body is 512 KiB. The fresh Admin API read supports up to
100 order lines/fulfillment orders/fulfillment-order lines, and fewer than 100
existing fulfillments. Larger/paginated responses never trigger a partial write.

## 4. Generic product and cart contract

Edit **`config/qikink-products.json` in birthday-celebration**. It starts empty;
there is no automatic mug fallback. Each entry maps one Shopify variant (including
its size/colour) to a Qikink SKU and the print settings for that product. The same
connector handles all configured entries. Use Qikink's actual SKU and template;
the connector cannot infer them from a product name or customer photo.

```json
[
  {
    "variantId": "REPLACE_WITH_NUMERIC_SHOPIFY_VARIANT_ID",
    "sku": "REPLACE_WITH_EXACT_QIKINK_SKU",
    "printTypeId": 5,
    "placements": [
      {
        "key": "front",
        "placementSku": "fr",
        "providerPlacement": "Front",
        "widthInches": 8.5,
        "heightInches": 3.5,
        "pixelWidth": 2550,
        "pixelHeight": 1050,
        "artworkProperty": "Print artwork",
        "previewProperty": "Approved preview"
      }
    ]
  }
]
```

The dimensions/method above illustrate the previous mug setup; **confirm the real
vendor template before using them**. Earlier sandbox output reversed the mug's
axes. Other products have their own SKU, method, dimensions and placements. Add a
second placement for back/sleeves as needed, with distinct cart-property names.
Up to six placements are supported through the documented printed-order contract;
unsupported Qikink product-specific features need their own API contract check.

The current mug cart properties remain valid: `Print artwork`, `Approved preview`,
`Message`, `Design ID`, `Design approved=Yes`, `Print placement=Front only`,
`_whb_personalized=mug-front-v1`. Routing uses the server's variant mapping and
configured image-property names. Approval properties are customer evidence, not a
merchant gate in this automatic version. Future products may use other markers
and property names. Use `_pod_customized=Yes` for new customizers; the legacy
`_whb_personalized` marker is also recognized. Either marker (or `Print artwork`)
on an unmapped variant holds the order
instead of silently dropping a customized line. Ordinary unmapped items are left
for their existing fulfillment flow.

Prices come from the actual paid Shopify order, including discount allocations;
there is no fixed mug price. Supported delivery is prepaid INR to India, quantity
1–100 per line. A discount that cannot be represented as exact per-unit paise is
held rather than rounded silently. Mixed carts send only mapped lines. One Qikink
order contains those lines and their distinct design identities. The declared
retail value is their discounted subtotal, not a fulfillment-cost quotation.

Your customizer must supply finished flat artwork and a preview on exact trusted
HTTPS hosts. The worker downloads and fully decodes PNG/JPEG bytes and checks each
configured artwork size (25 MB/image, 64 million pixels maximum). It does not
render a new product mockup or judge whether the text/photo looks right. Use
versioned, durable image URLs that Qikink can fetch; expiring or mutable links can
still fail after our check. This simple version stores URLs and a request digest, not image copies.

## 5. Native Qikink duplicate fulfillment

Ensure the native Shopify–Qikink app or another automation does not also import
these custom variants. Keep ordinary products on their existing path. Configure
an exclusive merchant-managed fulfillment location. Before submission the worker
checks that the exact mapped lines remain open, unsubmitted and assigned there,
with no third-party fulfillment service. These checks do not prove how a separate
native app imports orders; the MCP operator must confirm its SKU/variant exclusion.

## 6. Actions for the Shopify MCP operator

1. Confirm the app, authentication model, scopes and protected customer data access.
2. Supply the Shopify variant IDs, corresponding Qikink SKUs and verified print
   settings for products you choose to add. No complete future catalog is needed.
3. Preserve the customizer; ensure its cart properties contain the final artwork
   and preview for every configured placement.
4. Confirm native-import exclusion and provide the merchant-managed location ID.
5. After separately approved deployment, verify the callback and create/update the
   four app-owned subscriptions. Remove obsolete/duplicate subscriptions deliberately.
6. Coordinate the first paid order and provider costs before enabling live submission.

Codex did not make any of those Shopify changes.

## 7. Private environment variables

### Next.js — server-only deployment settings / local `.env.local`

```dotenv
SHOPIFY_POD_ENABLED=false
SHOPIFY_SHOP_DOMAIN=YOUR_SHOP.myshopify.com
SHOPIFY_APP_URL=https://www.wishhappybdayto.me
SHOPIFY_APP_CLIENT_ID=PRIVATE_APP_CLIENT_ID
SHOPIFY_APP_CLIENT_SECRET=PRIVATE_APP_CLIENT_SECRET
SHOPIFY_AUTH_MODE=client_credentials
# Alternative existing offline-token model only:
SHOPIFY_ADMIN_ACCESS_TOKEN=PRIVATE_OFFLINE_TOKEN_IF_SELECTED
SHOPIFY_FULFILLMENT_LOCATION_ID=gid://shopify/Location/CONFIRMED_LOCATION_ID
POD_ASSET_HOSTS=cdn.shopify.com,OTHER_EXACT_IMAGE_HOST
CMS_URL=HTTPS_CONTENTHUB_ORIGIN
POD_CMS_TOKEN=PRIVATE_RESTRICTED_STRAPI_TOKEN
POD_RELAY_SECRET=PRIVATE_RANDOM_32_TO_256_CHARACTERS
POD_WORKER_SECRET=PRIVATE_RANDOM_32_TO_256_CHARACTERS
QIKINK_LIVE_CLIENT_ID=PRIVATE_LIVE_CLIENT_ID
QIKINK_LIVE_SECRET=PRIVATE_LIVE_SECRET
QIKINK_LIVE_ACCOUNT_ID=CONFIRMED_NUMERIC_ORDER_REFERENCE_PREFIX
QIKINK_LIVE_ENABLED=false
POD_ALLOWED_ORDER_IDS=
```

`QIKINK_LIVE_ACCOUNT_ID` is not assumed to equal ClientId. Live endpoints are fixed
to `https://api.qikink.com`; the sandbox client remains separate. Adding keys does
not enable writes. `POD_ALLOWED_ORDER_IDS` accepts comma-separated Shopify numeric
order IDs; empty allows none. After a successful controlled release, `*` explicitly
allows all otherwise valid mapped orders. Do not set it during this implementation.

For hosting that needs configuration outside Git, optional server-only
`QIKINK_PRODUCTS_JSON` overrides the product file using the same JSON array.
Never put credentials in the product file or any `NEXT_PUBLIC_` variable.

### Contenthub

```dotenv
POD_RELAY_SECRET=SAME_PRIVATE_SHARED_SECRET_AS_NEXT
```

Create one **Custom Content API token** with exactly this action:
`api::pod-order.pod-order.state`. Put it in Next's `POD_CMS_TOKEN`. Public and normal
user roles get no permission. Full-access, read-only, extra-action tokens and user
JWTs are rejected. The relay secret is separately required. Contenthub never needs
the Qikink credentials. The old `SHOPIFY_MUG_*`, `MUG_*` production variables and
three old review/intake/worker tokens are unused by this connector; retire them
when no old deployment depends on them.

## 8. Deployment, scheduling and rollback

1. Review the code and test report. Deploy Contenthub first with its additive private
   `pod_orders` table and restricted token. Then deploy Next with both flags false.
2. Configure the product mappings, trusted hosts, app credentials and location.
   Verify native import exclusion. Then deliberately enable intake and subscriptions.
3. Next acknowledges capture before dispatch. Its `after()` callback starts one
   saved order when live submission is enabled. Configure a recovery scheduler to
   **POST `/api/internal/pod/run`** every minute with
   `Authorization: Bearer <POD_WORKER_SECRET>`. The scheduler also polls status and
   tracking. It must support authenticated POST; a bare GET cron does not process
   orders. The code does not register a scheduler or Shopify subscriptions.
4. Each invocation claims one database lease for 180 seconds; the Next function
   budget is 120 seconds. Concurrent workers cannot submit the same intent twice.
5. Kill switch: set `QIKINK_LIVE_ENABLED=false` and stop the scheduler. This pauses
   submission and polling/fulfillment. A POST already in flight may exist at Qikink;
   reconcile it. Disabling a flag does not cancel an existing paid provider order.
6. Roll back code with writes disabled. Keep order records, references and provider
   IDs. Never delete history or change a reference to force another submission.

The former mug review workflow was not deployed by this task. If it was deployed
elsewhere, retain/migrate its unresolved intent/provider history before removing
its schemas. Do not let automatic schema cleanup discard real order history.

### Status, recovery and privacy

Intent/request digest is saved before the one Qikink POST. Timeouts, malformed
success and failed result persistence enter reconciliation of the same reference.
A bounded empty provider search **does not** authorize another POST. Such an order
requires investigation. The private status endpoint is
**GET `/api/internal/pod/run?orderId=NUMERIC_SHOPIFY_ID`** with the same worker Bearer
secret; it returns status/provider ID, not contact details or image links.

Provider reads verify SKU, quantity, design identity, dimensions, placement,
artwork and preview for every line. Valid shipment tracking fulfills only the
explicit mapped Shopify fulfillment-order lines. Fulfillment intent is also
saved before mutation; uncertain results reconcile exact line quantities/AWB.
Tracking replacement after fulfillment is held for manual correction.

Cancellation, refund or a relevant edit after submission holds further writes;
provider cancellation requires operator action. Current Shopify data is re-read
before submission and fulfillment. A cross-system change can still occur between
that read and the external POST. No undocumented provider cancellation/cost API
is assumed.

Private snapshots contain delivery details and image links. No raw payload,
provider error or credential is intentionally logged or exposed publicly. Restrict
DB/backups and hosting logs. Set a retention policy before launch. The restricted
state API supports `op=erase`, `orderKey`, `confirmErase=true`: it scrubs the local
snapshot/tracking and prevents replay restoration, retaining minimal duplicate
history. Shopify, Qikink, image-host and backup deletion remain separate actions.

## 9. First live order

Keep `QIKINK_LIVE_ENABLED=false` while reviewing the configured product and captured
paid order. Confirm its actual artwork, SKU/placements, destination, complete Qikink
cost and native-import exclusion. Obtain authorization to spend that cost. Put
only its Shopify order ID in `POD_ALLOWED_ORDER_IDS`, then deliberately enable
live submission for that controlled run. Check the private status endpoint and
saved Qikink ID, provider details and later Shopify tracking. Disable afterward
while evaluating the result. A physical sample is separate from an API success.

## 10. Remaining setup and verified tests

See [the generic connector test report](test-runs/2026-10-27-generic-pod.md).
Tests use dummy credentials, synthetic images/orders, disposable SQLite/PostgreSQL
and mocked external writes. No real provider order/payment is part of the gate.

External setup still required: actual product mappings/templates, live app grant
and protected data, location/native-import exclusion, private hosting settings,
recovery schedule, retention/cancellation procedures and authorization for the
first paid order. Live credentials have not been used to certify a real shipment.

Official references: [Qikink API](https://documenter.getpostman.com/view/26157218/2sBYAysUHS),
[Shopify webhook verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries),
[client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant),
[2026-10 order fields](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order),
[fulfillmentCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/fulfillmentCreate).
