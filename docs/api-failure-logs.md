# Investigating celebration API failures

Search the **Contenthub/Strapi runtime logs** for `api_request_failed` after
deploying and restarting the backend with this change. These entries are
written by Strapi, so the frontend's Vercel function logs are not their source.

On the currently deployed version, look for `/api/happy-birthdays` in request
logs and `Create celebration failed:` or `Invalid key message` in exception
logs. The old controller logs create exceptions only; it does not provide a
consistent marker for authentication, policy or GET failures.

Every HTTP 4xx/5xx response or thrown request error on `/api/happy-birthdays`
and its child routes, and `/api/users/me`, produces one structured entry.
Successful requests and other endpoints produce no entry from this middleware.
The middleware runs before authentication, policies, query parsing, body parsing
and controllers, and inside Strapi's error handler. It rethrows the original
exception so Strapi keeps its normal response formatting and status code.
Requests rejected by a proxy before reaching Strapi will not appear here.

## What to search

Start with `api_request_failed`, then filter by:

| Search text | Meaning |
| --- | --- |
| `"endpoint":"/api/happy-birthdays"` | Celebration collection and child-route failures |
| `"route":"/api/happy-birthdays"` | Only the collection endpoint in the screenshot |
| `"method":"POST"` | Creation failures |
| `"method":"GET"` | Read or availability failures |
| `"status":400` | Invalid input/query/schema |
| `"status":401` | Authentication failure |
| `"status":403` | Permission denial |
| `"status":409` | Conflict, including an already-used link |
| `"status":429` | Rate limiting |
| `"status":500` | Internal failure; also inspect adjacent normal Strapi exception logs |
| `"invalidField":"message"` | The unsupported headline field from the original frontend create request |
| `"endpoint":"/api/users/me"` | Account/session failures |

An illustrative entry, not a captured production failure:

```text
[api_request_failed] {"event":"api_request_failed","requestId":"7ec42abd-fc43-469f-9565-a6807935cfaf","endpoint":"/api/happy-birthdays","route":"/api/happy-birthdays","method":"POST","status":400,"durationMs":12,"authStrategy":"api-token","hasAuthorization":true,"publicationStatus":"published","lookupBy":"other","errorName":"ValidationError","reason":"invalid_field","invalidField":"message"}
```

Group records by `route`, `method`, `status`, `reason` and `invalidField`.
This separates schema failures from rejected sessions, conflicts and 5xx errors.
These logs include failures only: use dashboard request totals from the same
window to calculate error rates. `hasAuthorization` records header presence,
not whether credentials were valid; `authStrategy` may be `unknown` when auth
failed before a strategy was selected. `publicationStatus` and `lookupBy`
describe query shape without including lookup values.

Known validation field names appear in `validationFields` when available.
Allowlisted database/network codes appear in `errorCode`, such as `23505`,
`SQLITE_BUSY` or `ECONNREFUSED`. Unknown details use a general reason instead
of copying arbitrary error text. For unknown 5xx failures, normal Strapi
exception logs remain available and may be needed for the underlying stack.

Each failure adds an `X-Contenthub-Request-Id` response header matching the
entry's `requestId`. A request made directly to Strapi can be matched to its
log with that header. Next.js does not currently forward this header to the
browser. Each failed attempt gets its own server-generated ID; callers cannot
inject arbitrary log correlation values.

## Data and log levels

These structured entries contain no request/response bodies, raw query values,
names, emails, messages, upload contents, cookies, tokens, raw error messages,
SQL or stack traces. Document IDs and slugs in paths become route placeholders.
This filtering applies to these new entries; existing framework logs keep
their existing behavior. Four-hundred responses use `warn`, and five-hundred
responses use `error`; keep warning-level runtime logs enabled to see both.
A log transport failure cannot replace the original request result.

## Coverage and execution

`tests/api-failure-log.test.js` covers successful/unrelated requests, returned
and thrown failures, Strapi error status mapping, private data exclusion,
validation field filtering, auth/owner routes and logger failure. It is
discovered by `npm run test:unit` and `npm run check`.

The existing `tests/helpers/http-regression.cjs` real HTTP suite checks logging
of anonymous dashboard rejection, invalid `/users/me` credentials, unknown
`message` validation, matching response request IDs and no entry for successful
creation. It runs through `npm run test:integration` and `npm run check`.
Relevant frontend catalog cases are AUTH-04, CRT-10/17 and SEC-01.

No tests, HTTP probes, typechecks, lint or builds were run for this logging
request, because testing was not requested. Deployment, live log capture and
attribution of the screenshot's 16.3% remain outstanding.
