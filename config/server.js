const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';
const UNPUBLISH_DELAY_MS = 23 * 60 * 60 * 1000;
const UNPUBLISH_EXCLUDED_CUSTOM_ROUTES = ['elena', 'matt', 'mike'];

module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  cron: {
    enabled: true,
    tasks: {
      happyBirthdayAutoUnpublish: {
        task: async ({ strapi }) => {
          try {
            const cutoff = new Date(Date.now() - UNPUBLISH_DELAY_MS);

            const entries = await strapi.db
              .query(HAPPY_BIRTHDAY_UID)
              .findMany({
                where: {
                  publishedAt: {
                    $notNull: true,
                    $lte: cutoff,
                  },
                  customroute: {
                    $notIn: UNPUBLISH_EXCLUDED_CUSTOM_ROUTES,
                  },
                },
                select: ['documentId', 'locale'],
              });

            if (!entries.length) {
              return;
            }

            const targets = new Map();
            for (const entry of entries) {
              if (!entry.documentId) {
                continue;
              }

              const localeKey = entry.locale || '';
              const key = `${entry.documentId}:${localeKey}`;
              if (!targets.has(key)) {
                targets.set(key, {
                  documentId: entry.documentId,
                  locale: entry.locale,
                });
              }
            }

            for (const target of targets.values()) {
              const params = { documentId: target.documentId };
              if (target.locale) {
                params.locale = target.locale;
              }

              await strapi.documents(HAPPY_BIRTHDAY_UID).unpublish(params);
            }

            strapi.log.info(
              `Auto-unpublished ${targets.size} happy-birthday documents.`
            );
          } catch (error) {
            strapi.log.error(
              'Failed to auto-unpublish happy-birthday entries:',
              error
            );
          }
        },
        options: {
          rule: '0 * * * *',
        },
      },
    },
  },
});
