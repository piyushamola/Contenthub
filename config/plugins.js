module.exports = ({ env }) => ({
  upload: { config: { breakpoints: {} } }, // disable small/medium/large
  'strapi-v5-plugin-populate-deep': {
    config: {
      defaultDepth: 5, // Default is 5
    },
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
