module.exports = ({ env }) => ({
  email: {
    config: {
      provider: "sendgrid",
      providerOptions: {
        apiKey: env("SENDGRID_API_KEY"),
      },
      settings: {
        defaultFrom: env("EMAIL_DEFAULT_FROM"),
        defaultReplyTo: env("EMAIL_DEFAULT_REPLY_TO"),
      },
    },
  },
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
  // "strapi-plugin-ckeditor": {
  //   enabled: true,
  // },
});
