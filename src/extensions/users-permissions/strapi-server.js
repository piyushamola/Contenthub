'use strict';

/**
 * Adds a `displayName` field to the users-permissions User model.
 *
 * IMPORTANT: this must mutate the plugin's existing content-type definition
 * rather than replace it. Dropping a
 * `src/extensions/users-permissions/content-types/user/schema.json` file
 * (the Strapi v4-era pattern) was tried first and it replaced the User
 * schema instead of merging with it, which silently dropped every
 * users-permissions column (username, email, password, role, etc.) from the
 * database on the next boot. This `strapi-server.js` override is the
 * correct, non-destructive Strapi v5 approach.
 */
module.exports = (plugin) => {
  plugin.contentTypes.user.schema.attributes.displayName = {
    type: 'string',
  };

  /**
   * The stock `GET /api/users/me` controller silently drops the `role`
   * relation from its response regardless of `?populate=role` (verified by
   * testing directly against this Strapi version) — the plugin's own
   * `fetchAuthenticatedUser()` service method populates role correctly and
   * exists for exactly this purpose, but the default `me` action does not
   * use it. The Next.js app needs `role.type` here to know whether the
   * logged-in user is an Admin, so `me` is overridden to return it directly.
   */
  plugin.controllers.user.me = async (ctx) => {
    const authUser = ctx.state.user;
    if (!authUser) return ctx.unauthorized();

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: authUser.id },
      populate: { role: { select: ['id', 'name', 'type'] } },
    });
    if (!user) return ctx.notFound();

    const {
      password: _password,
      resetPasswordToken: _resetPasswordToken,
      confirmationToken: _confirmationToken,
      ...safeUser
    } = user;

    ctx.body = safeUser;
  };

  return plugin;
};
