'use strict';

/**
 * This Strapi version's OAuth (grant) flow stores the completed provider
 * token exchange in the request's server-side session
 * (`ctx.session.grant.response`), tied to the `koa.sess` cookie set on
 * Strapi's own origin during `/api/connect/:provider`. It does NOT pass the
 * result back to the configured frontend callback URL as a query param.
 *
 * Since our Next.js app runs on a different origin (localhost:3000 vs
 * Strapi's localhost:4000), a server-to-server fetch from Next.js can never
 * carry that session cookie. So this route is configured as the OAuth
 * provider's "callback" URL instead of the Next.js URL directly — it runs
 * on Strapi's own origin (same session, no cross-site cookie problem),
 * finishes the login there, and only then redirects the browser to the
 * Next.js app with a real, already-issued JWT in the query string.
 */
/**
 * NOTE ON THE PATH: since this API has no content-type, Strapi does not
 * register it as a formal `api::` module and does NOT add the usual `/api`
 * REST prefix. Verified by booting Strapi and inspecting the live router:
 * this route is reachable at `http://localhost:4000/oauth-bridge/google/callback`
 * (no `/api`), which is exactly the URL configured as the Google provider's
 * "callback" in the store (see the setup steps in README-STRAPI-SETUP.md).
 */
module.exports = [
  {
    method: 'GET',
    path: '/oauth-bridge/:provider/callback',
    handler: 'api::oauth-bridge.oauth-bridge.callback',
    config: {
      auth: false,
      policies: [],
    },
  },
];
