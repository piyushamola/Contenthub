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
  // "strapi-plugin-ckeditor": {
  //   enabled: true,
  // },
});
