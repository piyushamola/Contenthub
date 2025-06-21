module.exports = ({ env }) => ({
  upload: { config: { breakpoints: {} } }, // disable small/medium/large

  "webp-converter": {
    enabled: true,
    config: {
      mimeTypes: ["image/png", "image/jpeg", "image/jpg"],
      options: {
        quality: 100,
        effort: 4,
        smartSubsample: true,
      },
    },
  },
  email: {
    config: {
      provider: "@strapi/provider-email-nodemailer",
      providerOptions: {
        host: "smtp-relay.brevo.com", // Brevo SMTP gateway
        port: 587, // use 465 if you need SSL-only
        secure: false, // STARTTLS on 587
        auth: {
          user: env("BREVO_SMTP_USER"), // usually same as your login email
          pass: env("BREVO_SMTP_KEY"), // your SMTP key
        },
      },
      settings: {
        defaultFrom: env("EMAIL_DEFAULT_FROM"),
        defaultReplyTo: env("EMAIL_DEFAULT_REPLY_TO"),
      },
    },
  },
  // "strapi-plugin-ckeditor": {
  //   enabled: true,
  // },
});
