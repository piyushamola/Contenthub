# Auth email and Google sign-in production setup

## What the app now configures

On Strapi startup, new email/password registrations require email confirmation. Confirmation returns users to `FRONTEND_URL/login?confirmed=1`, and password resets open `FRONTEND_RESET_PASSWORD_URL` (or `FRONTEND_URL/reset-password`). Set `FRONTEND_URL=https://www.wishhappybdayto.me` in Strapi Cloud.

The first startup replaces Strapi's stock confirmation and reset messages with the branded templates in [`src/email-templates/confirmation.html`](../src/email-templates/confirmation.html) and [`src/email-templates/reset-password.html`](../src/email-templates/reset-password.html). Edit them later in **Strapi Admin → Settings → Users & Permissions Plugin → Email templates**. Startup preserves edited messages. The confirmation button uses `<%= URL %>?confirmation=<%= CODE %>`; the reset button uses `<%= URL %>?code=<%= TOKEN %>`. Keep these expressions in the links.

The confirmation email includes a small gallery link. Keep password-reset emails focused on the reset action for clarity and deliverability. The celebration-created email also has a button and dashboard link. Its delivery is scheduled after the create lifecycle returns; it is best effort and errors appear in Strapi logs. A process crash before send can still lose that message; a durable mail queue would be needed for guaranteed delivery.

## Sending from wishhappybdayto.me

Strapi Cloud's included sender cannot be changed to an arbitrary domain by setting a `From` field. [Strapi recommends a custom email provider for custom-domain sending](https://support.strapi.io/articles/8286789511-using-a-custom-email-provider-with-strapi-cloud). This project supports either SendGrid or Brevo in production:

1. In your chosen provider, verify `wishhappybdayto.me` and add its required SPF/DKIM DNS records. Create an address such as `hello@wishhappybdayto.me`.
2. In Strapi Cloud environment variables, set **one** provider credential: `SENDGRID_API_KEY`, or both `BREVO_SMTP_USER` and `BREVO_SMTP_KEY`. If both exist, SendGrid takes priority. The packages are already installed.
3. Set `EMAIL_DEFAULT_FROM=WishHappyBday <hello@wishhappybdayto.me>` and `EMAIL_DEFAULT_REPLY_TO=hello@wishhappybdayto.me` in Strapi Cloud. Restart/redeploy Strapi. Startup sets the Users & Permissions template sender fields from these values too.
4. Inspect the confirmation and reset templates in Strapi Admin. Send a provider test email to an inbox you control, then register a new test account and request a reset. Check Strapi Cloud logs and spam folders if delivery fails.

Without a custom provider, the site continues using the Strapi Cloud sender. Changing the template sender before the domain is verified may cause rejected mail. [Strapi email setup](https://docs.strapi.io/cms/features/email).

## Google account chooser name

The Google chooser currently shows the Strapi Cloud hostname because Google's callback is on that host. To give the callback a branded hostname:

1. Add a Strapi Cloud custom domain such as `auth.wishhappybdayto.me` (the main site already uses `www.wishhappybdayto.me`). Follow [Strapi Cloud custom domain setup](https://support.strapi.io/articles/8858437367-using-custom-domains-with-strapi-cloud) and wait for HTTPS to work.
2. Set `PUBLIC_URL=https://auth.wishhappybdayto.me` in Strapi Cloud and redeploy Strapi. `config/server.js` uses this as Strapi's public URL for OAuth callbacks and confirmation links.
3. In Google Cloud OAuth client settings, add `https://auth.wishhappybdayto.me/api/connect/google/callback` as an authorized redirect URI. Update the Google provider's **The redirect URL to your front-end app** field in Strapi Admin to `https://auth.wishhappybdayto.me/oauth-bridge/google/callback`. Keep the existing Google authorized redirect URI temporarily during the changeover.
4. In Vercel, change `STRAPI_URL`, `CMS_URL`, and any public CMS URL variables used by the site to the new Strapi origin. Redeploy the frontend. Confirm `/api/auth/google` starts on the new origin and the whole OAuth round trip works.
5. In Google Auth Platform → Branding, set the app name to WishHappyBday, homepage to `https://www.wishhappybdayto.me`, and matching privacy/terms URLs. Verify the `wishhappybdayto.me` domain, submit branding verification, and publish the approved branding. [Google says the verified app name is shown after verification](https://support.google.com/cloud/answer/15549049?hl=en). Until then the chooser may show the callback domain, likely `auth.wishhappybdayto.me`, rather than the exact apex domain.

Do not point the Strapi custom domain at the Vercel frontend; they must have separate hostnames.
