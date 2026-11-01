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
      // Internal erasure requests carry the verified owner and country in JSON.
      // koa-body otherwise skips DELETE and the controller receives an empty body.
      parsedMethods: ["POST", "PUT", "PATCH", "DELETE"],
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
