const cronTasks = require('./cron-tasks');

module.exports = ({ env }) => {
  const expiryCronEnabled = env.bool(
    'CELEBRATION_EXPIRY_CRON_ENABLED',
    env('NODE_ENV') === 'production'
  );

  return {
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
    // Used by Strapi to build Google OAuth and email-confirmation URLs.
    url: env('PUBLIC_URL', ''),
    app: {
      keys: env.array('APP_KEYS'),
    },
    cron: {
      enabled: expiryCronEnabled,
      tasks: cronTasks,
    },
    webhooks: {
      populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
    },
  };
};
