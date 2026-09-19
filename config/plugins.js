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
  // email: {
  //   config: {
  //     provider: "sendgrid",
  //     providerOptions: {
  //       apiKey: env("SENDGRID_API_KEY"),
  //     },
  //     settings: {
  //       defaultFrom: env("EMAIL_DEFAULT_FROM"),
  //       defaultReplyTo: env("EMAIL_DEFAULT_REPLY_TO"),
  //     },
  //   },
  // },
  // "strapi-plugin-ckeditor": {
  //   enabled: true,
  // },
  email: {
    config: {
      settings: {
        // Format: "Sender Name <sender-email@domain.com>"
        defaultFrom: "wishhappybday@gmail.com",
        // Format: "Reply Name <reply-email@domain.com>" or "reply-email@domain.com"
        defaultReplyTo: "wishhappybday@gmail.com",
      },
    },
  },
});
