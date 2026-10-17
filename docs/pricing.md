# Standard Premium and Birthday Story pricing

One **Premium pricing** singleton holds the independent prices for both paid
products. Open **Content Manager → Single Types → Premium pricing**. Enter
major currency units with at most two decimal places: `9` means ₹9, and `1.25`
means US$1.25.

| Product/region | Current field | Default | Optional original field |
| --- | --- | --- | --- |
| Standard Premium, India | `indiaPriceRupees` | 9 | `indiaOriginalPriceRupees` |
| Standard Premium, other countries | `otherCountriesPriceUsd` | 1 | `otherCountriesOriginalPriceUsd` |
| Birthday Story, India | `storyIndiaPriceRupees` | 36 | `storyIndiaOriginalPriceRupees` |
| Birthday Story, other countries | `storyOtherCountriesPriceUsd` | 5 | `storyOtherCountriesOriginalPriceUsd` |

## Current and original amounts

Current prices are the charged amounts. Each optional original is a comparison
price for that same product and currency and has no default. Use it only for
a truthful original-price comparison. The service includes it only when it is
positive, safe to convert to minor units, has at most two decimal places and
is strictly greater than the corresponding current price. Missing, malformed,
nonpositive, unsafe, equal, lower or overprecision originals produce no sale
comparison and do not block an otherwise valid current-price checkout.

CMS Save may accept extra original decimal places; the service ignores that
comparison rather than rounding it into a sale. Optional-display fallback is
separate from invalid current prices, which must not create invalid orders.
No percentage is stored. The frontend computes
`Math.round((original - current) / original * 100)`, using whole-percent labels.
A positive charge rounding to 100% displays **Over 99% off**; a rounded zero
omits the percentage badge. A valid original/current comparison can still
appear without a percentage badge.

## API and checkout contract

These Contenthub endpoints use the existing server API-token payment access
scope; they are consumed by Next's server layer:

| Endpoint | Result |
| --- | --- |
| `GET /api/celebration-payments/pricing` | Standard `INR`, `USD`, `originalINR`, `originalUSD` |
| `GET /api/celebration-payments/pricing?product=story` | Story values with the same keys |
| `GET /api/celebration-payments/access/:slug` | The celebration's authoritative billing quote and existing access fields; optional `originalAmountPaise` is display metadata |

API amounts are **minor units**: paise for INR and cents for USD. Thus ₹9 is
`900` and US$1.25 is `125`. `originalINR`/`originalUSD` are numbers or `null`;
older responses without them still mean no comparison. Access metadata
`originalAmountPaise` uses the quote's currency, including cents for USD
despite its field name. It never replaces `amountPaise` as the charge.

The access quote preserves the celebration's saved billing country. Next
reuses that uncached quote for Standard and Story payment dialogs rather than
replacing it with the visitor's market price. Public offers and builder entry
prices use the visitor's market and can differ when a creator travels. A
pending Story order remains quoted in its recorded currency and amount.
For legacy records without a valid saved country, the token-scoped backend
access endpoint accepts an optional `?country=XX` fallback. Next derives it
from its trusted visitor-country header and ignores a browser-supplied country
query. A valid saved country and any pending Story order take precedence;
malformed fallback values are ignored.
New orders use the current backend price; existing orders retain their saved
amount and currency after current or original price edits. A changed
current-price quote must be refreshed before payment rather than silently
charging another amount. Price metadata does not change ownership,
publication, entitlements or expiry.

## Deployment and price edits

1. Deploy the additive backend schema/service changes before the matching
   frontend and restart Strapi. Existing price records need no fabricated
   originals or order repricing.
2. Enter the desired current and optional original amounts for each product
   and region. The singleton has `draftAndPublish: false`: use **Save**, with
   no separate Publish step.
3. After saving, send the existing authenticated `POST /api/revalidate` to the
   frontend with `x-revalidate-secret` matching its `REVALIDATE_SECRET` and
   JSON `{"model":"premium-pricing"}`. Configure this in the CMS save workflow
   or invoke it after an authorized edit. One call clears cached public prices
   for both products, including removing a previously displayed comparison.
   Saving alone does not invalidate Next's public price cache.

Backend access/order reads remain uncached and independent of this public
cache. The [frontend setup](../../birthday-celebration/README-STRAPI-SETUP.md#standard-premium-and-birthday-story-pricing)
contains the webhook example and token/environment setup. The
[October 17 handoff](../../birthday-celebration/docs/2026-10-17-configurable-pricing.md)
connects both repositories' coverage and manual deployment checks.

## Coverage status

`tests/premium-pricing.test.js` and `tests/payment-regression.test.js` cover
conversion, optional-original eligibility, both products/currencies and
saved-order quotes. `scripts/test-birthday-story.cjs` and
`tests/helpers/premium-pricing-regression.cjs` add real Strapi persistence,
HTTP response and Story checkout coverage; the latter runs through the
existing HTTP integration helper. `scripts/test-regression-server.cjs`
covers the disposable launcher's token-protected mock-only pricing controls.
The sibling frontend adds unit, browser/API and real-stack coverage listed
in its handoff and NAV-03/PRICE-01–14 catalog cases.

**No tests or verification commands were run for this request.** These are
coverage references, not passing results. Run the appropriate documented
gates only when testing is explicitly requested. The earlier October 15–16
run records an older snapshot.
