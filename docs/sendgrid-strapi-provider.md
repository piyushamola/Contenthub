# Strapi 5 SendGrid provider

## Recommendation

Use Strapi's official `@strapi/provider-email-sendgrid` package at the same
minor/patch version as this application: `5.54.0`. Do not configure
`provider: "sendgrid"` while only the unrelated, legacy `sendgrid@5.2.3`
package is installed. That package is deprecated and does not implement
Strapi's email-provider interface.

Install the official provider and remove the legacy package:

```sh
npm install @strapi/provider-email-sendgrid@5.54.0 --save
npm uninstall sendgrid
```

The provider has a direct dependency on `@sendgrid/mail` and supports Node
20 through 26. The application uses Strapi `5.54.0` and Node 22, so the
matching provider version is compatible.

## Configuration

In `config/plugins.js`, configure the provider by its short official name:

```js
email: {
  config: {
    provider: "sendgrid",
    providerOptions: {
      apiKey: env("SENDGRID_API_KEY"),
      // region: "eu", // only for API keys created in SendGrid's EU portal
    },
    settings: {
      defaultFrom: env("EMAIL_DEFAULT_FROM"),
      defaultReplyTo: env("EMAIL_DEFAULT_REPLY_TO"),
    },
  },
},
```

`SENDGRID_API_KEY` is required. `defaultFrom` and `defaultReplyTo` are
optional provider settings, but both should be supplied from environment
variables in this application. Only one Strapi email provider is active at a
time.

For a SendGrid EU API key, set `region: "eu"`; otherwise the provider targets
the global endpoint and SendGrid returns `Unauthorized`.

## SendGrid prerequisites

Create an API key with permission to send mail, store it only in
`SENDGRID_API_KEY`, and verify the sender used by `EMAIL_DEFAULT_FROM`.
SendGrid requires a verified Sender Identity. Single Sender Verification is
acceptable for testing; Domain Authentication is the production setup and
verifies all addresses at that domain. Configure SPF/DKIM and use a
`defaultFrom` address on that verified domain for deliverability.

Also update the sender address in the Users & Permissions email templates in
the Strapi admin panel if those templates still contain `no-reply@strapi.io`.

## Sources

- [Strapi 5 Email documentation — provider installation and SendGrid configuration](https://docs.strapi.io/cms/features/email)
- [Official `@strapi/provider-email-sendgrid` package — version 5.54.0 metadata and README](https://www.npmjs.com/package/@strapi/provider-email-sendgrid)
- [Twilio SendGrid Mail Send API — API-key authentication and verified From address](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
- [Twilio SendGrid Sender Identity — test versus production verification](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sender-identity)
