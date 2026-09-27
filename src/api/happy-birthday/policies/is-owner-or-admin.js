'use strict';

const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';

/**
 * Allows the request when the authenticated user owns the celebration
 * referenced by :documentId, or belongs to the custom "Admin" role.
 * Never grants access to unauthenticated requests.
 */
module.exports = async (ctx, config, { strapi }) => {
  const user = ctx.state.user;
  if (!user) return false;

  const documentId = ctx.params?.documentId;
  if (!documentId) return false;

  const fullUser = await strapi
    .query('plugin::users-permissions.user')
    .findOne({ where: { id: user.id }, populate: ['role'] });

  if (fullUser?.role?.type === 'admin') return true;

  const entry = await strapi.db.query(HAPPY_BIRTHDAY_UID).findOne({
    where: { documentId, publishedAt: { $notNull: true } },
    populate: { owner: { select: ['id'] } },
  });

  if (!entry || !entry.owner) return false;

  return entry.owner.id === user.id;
};
