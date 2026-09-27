'use strict';

/**
 * Allows the request only when the authenticated user belongs to the
 * custom "Admin" users-permissions role (type: "admin"). This is distinct
 * from Strapi's own Admin Panel users/roles.
 */
module.exports = async (ctx, config, { strapi }) => {
  const user = ctx.state.user;
  if (!user) return false;

  const roleType = user.role?.type;
  if (roleType === 'admin') return true;

  // ctx.state.user from the JWT auth strategy does not always include the
  // populated role, so re-fetch defensively before denying access.
  const fullUser = await strapi
    .query('plugin::users-permissions.user')
    .findOne({ where: { id: user.id }, populate: ['role'] });

  return fullUser?.role?.type === 'admin';
};
