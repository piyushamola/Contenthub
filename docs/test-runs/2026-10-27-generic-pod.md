# Generic Shopify → Qikink connector — 2026-10-27

## Result

Replaced the earlier mug-only/manual-review implementation with one generic,
automatic Next.js connector and one private Contenthub order collection. This is
repository code for review, not a deployed or live-certified service. No Shopify
configuration, subscription, live provider order, payment or permission was changed.

### Kept

- One signed Shopify webhook, private background worker/status endpoint and live
  Qikink client. The webhook captures before acknowledging, then Next `after()`
  can process a saved order. A scheduled POST handles recovery/status polling.
- One product configuration file; multiple variants/SKUs, prices and front/back/
  other configured placements use the same order builder. Mixed carts forward
  only mapped lines; unknown customized lines are held rather than dropped.
- Actual image download/decode, payment/refund/cancellation checks, durable
  leases/intent, one provider POST and reconciliation after uncertain outcomes.
- Exact mapped-line Shopify fulfillment/tracking, private redacted status and
  local erasure/replay protection.
- Independent sandbox tooling/tests. Its local journal never owns production state.

### Removed

The mug review UI/API, merchant approval binding, image-copy/encryption collection,
per-line review jobs, separate mug order/receipt collections, three-token review
configuration, hardcoded mug SKU/₹349 price/front-only canvas and obsolete routes.
The old production test report is available in Git history; current results are
recorded here. Sandbox investigation notes remain separate and historical.

Contenthub's unrelated pre-existing 75-line generated-type change remains unstaged
and is not part of this work. No push or PR was created, per the user's instruction.

## Final checks

All checks used Node **22.23.4**, synthetic order/image fixtures, dummy credentials,
disposable databases and mocked external writes. Nothing submitted a real provider
order or payment. Existing isolated runners and network guards were retained.

| Repository | Command | Actual final result |
| --- | --- | --- |
| Frontend | `npm run test:unit` | **339 passed; 0 failed, skipped or cancelled** |
| Frontend | `npm run typecheck` | Passed normal/isolated route generation and TypeScript |
| Frontend | `npm run test:e2e -- tests/e2e/pod-api.spec.ts --project=api` | **1 passed**, including an isolated production build |
| Frontend | `npm run test:stack -- tests/stack/pod.spec.ts` | **3 passed**, including real Next/Contenthub HTTP/database integration and a fresh production build |
| Contenthub | `npm run check` | **134 unit tests passed**, real SQLite HTTP/database and existing regression/server suites passed; admin build passed |
| Contenthub | `npm run test:pod:postgres` | Passed all **8 HTTP/database groups**, including simultaneous first deliveries and competing leases |

The stack case runs in the Chromium, mobile Chromium and WebKit projects, but
exercises HTTP contracts, not a browser review UI (that UI was removed). It sends
signed mixed-product events through Next into real Strapi, checks one private
record and redacted status, confirms default-off submission and cancellation hold.
Provider creation/fulfillment and timeouts are tested with external boundary
doubles; no live shipment is claimed.

The PostgreSQL gate **was executed** against a disposable local PostgreSQL 16
cluster. It tests concurrent first capture, competing claims, intent/crash
reconciliation, failed DB writes, original-worker late results, cancellation before
and during submission, edits/removal, exact fulfillment recovery, private access
and erasure. The same HTTP suite runs in the full SQLite gate. Failures do not
acknowledge capture, and unrelated ordinary orders create no POD record.

Frontend focused coverage is in `tests/unit/pod-*.test.ts`, `tests/e2e/pod-api.spec.ts`
and `tests/stack/pod.spec.ts`. These are discovered by existing documented gates.
Applicable catalog IDs: **POD-07–14**. No full frontend media gate or unrelated
browser suite was run for this server-only change. The backend full gate also
checks existing celebration, pricing, ownership, payment/refund, expiry and server
behavior using simulated providers.

## Red → green findings

Initial tests failed while the new order module and private API action did not
exist. Focused behavior tests also exposed and fixed these cases:

- Cancellation/refund must still be captured after product configuration is emptied.
- Shopify order-level discount allocations must affect the actual selling price.
- Missing configuration must hold a queued order, rather than continually defer.
- Provider reconciliation must reject missing/zero/unsafe numeric order IDs.
- Ordinary unconfigured cart orders should be ignored without storing their data.
- Removing the final personalized line needs a permanent stop tombstone so delayed
  paid events cannot restore it. Same-second pre-submission updates can replace a
  queued snapshot; a fresh authoritative Shopify read still precedes any POST.

Those failing attempts were not counted as successful checks. The final runs in
the table passed without skips, retries, weakened assertions or timeout increases.
Existing Strapi update-notification/Zod annotation warnings are non-fatal.

## Live setup still needed

A presence-only local configuration check read `.env`, `.env.local` and
`.env.production.local` without printing values. The new Qikink live variables,
Shopify app/domain/location variables and private POD credentials/asset hosts were
not populated there. Hosting may have separate configuration; none was inspected
or changed. Existing sandbox credentials were not repurposed as live credentials.
No real live authentication/order-read smoke test was performed without an
explicitly configured live identity.

`config/qikink-products.json` deliberately starts empty. Add confirmed Shopify
variant → Qikink SKU/method/placement/template mappings before enabling intake.
Confirm native Qikink import exclusion, protected customer data access, hosting
configuration, the recovery scheduler, provider costs and retention/deletion
procedures. Do not assume an app setting or fixture proves these external facts.

Intake and live submission default off. Keep `QIKINK_LIVE_ENABLED=false` and an empty
allowlist until the user reviews the code and authorizes a controlled paid order.
A provider search after uncertain submission never authorizes a blind retry.
Original image URLs must remain durable/versioned for Qikink; there is no immutable
image proxy in this simpler version. Physical print quality, template orientation,
manual provider cancellation and tracking replacement require external checks.

See [the deployment handoff](../shopify-production-handoff.md) for every variable,
restricted token permission, product example, callback/topic contract and first
live order procedure.
