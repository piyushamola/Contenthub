module.exports = [
  "strapi::logger",
  "strapi::errors",
  "global::api-failure-log",
  "strapi::security",
  "strapi::cors",
  "strapi::poweredBy",
  "strapi::query",
  {
    name: "strapi::body",
    config: {
      multipart: true,
      formLimit: "256mb",
      jsonLimit: "256mb",
      textLimit: "256mb",
      formidable: {
        maxFileSize: 50 * 1024 * 1024, // 50MB (adjust)
      },
    },
  },
  "strapi::session",
  "strapi::favicon",
  "strapi::public",
];
