module.exports = ({ env }) => ({
  email: {
    config: {
      provider: "@strapi/provider-email-sendgrid",
      providerOptions: {
        apiKey: env("SENDGRID_API_KEY"),
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
