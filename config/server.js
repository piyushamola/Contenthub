const cronTasks = require('./cron-tasks');

module.exports = ({ env }) => {
  const expiryCronEnabled = env.bool(
    'CELEBRATION_EXPIRY_CRON_ENABLED',
    env('NODE_ENV') === 'production'
  );

  return {
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
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
