# Strapi Cloud managed email settings

## Finding

The managed Strapi Cloud email provider shown in the admin UI as
`strapi-provider-email-strapi-cloud` does **not** have a documented,
supported configuration for a custom default sender email or default response
(reply-to) email. Strapi's Cloud guide says the out-of-the-box service can send
mail and support the forgot-password flow, but that its default sender and
response addresses cannot be changed. The screenshot matches that behaviour:
those fields are read-only.

Source: [Strapi Cloud email provider guide](https://strapi.io/blog/how-to-setup-external-email-provider-on-strapi-cloud-1#strapi-cloud-out-of-the-box).

There is no separately documented `defaultFromName` setting. In standard
Strapi email configuration, the UI derives **Default sender name** from the
display name included in `settings.defaultFrom` and derives reply-to name the
same way from `settings.defaultReplyTo`.

Source: [Strapi Email feature documentation](https://docs.strapi.io/cms/features/email#admin-panel-settings).

## What the standard configuration fields mean

For a configurable provider, the documented fields are:

```js
email: {
  config: {
    provider: 'provider-name',
    providerOptions: {
      // provider-specific credentials
    },
    settings: {
      // The display name is part of the RFC 5322 mailbox value.
      defaultFrom: 'Contenthub <hello@example.com>',
      defaultReplyTo: 'Contenthub Support <support@example.com>',
    },
  },
},
```

- `settings.defaultFrom` supplies the default sender; putting `Name <email>`
  here is how Strapi displays a sender name.
- `settings.defaultReplyTo` supplies the default response/reply-to address;
  it can also include `Name <email>`.
- There is no `defaultFromName`, `defaultSenderName`, or
  `defaultResponseEmail` configuration key in the documented API.

Sources: [configuration options](https://docs.strapi.io/cms/features/email#email-configuration-options) and [email `send()` defaults](https://docs.strapi.io/cms/features/email#using-the-send-function).

## Consequence for this project

Do **not** add an `email` block that guesses a configuration contract for
`strapi-provider-email-strapi-cloud`. The current official Cloud documentation
only documents `/config/env/production/plugins.js` for configuring **another**
provider. It does not document a configuration shape that customizes the
managed provider's sender settings.

If custom sender/reply-to values are mandatory, switch to a supported external
provider (for example, SendGrid, Mailgun, Amazon SES, or Nodemailer). Strapi's
Cloud support documentation explicitly lists those supported providers, and the
main Email documentation contains the provider configuration pattern.

Sources: [Cloud custom-provider support](https://support.strapi.io/articles/8286789511-using-a-custom-email-provider-with-strapi-cloud) and [provider configuration](https://docs.strapi.io/cms/features/email#configuring-providers).

The checked-in `config/env/production/plugins.js` is the correct file location
if the project later chooses such a replacement provider. Adding
`defaultFrom`/`defaultReplyTo` there is documented only together with that
provider's configuration; it is not an officially verified override for the
managed Cloud provider.
