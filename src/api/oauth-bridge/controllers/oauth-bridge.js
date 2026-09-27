'use strict';

function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:3000';
}

module.exports = {
  async callback(ctx) {
    const { provider } = ctx.params;
    const loginErrorUrl = `${frontendUrl()}/login?error=google`;

    // Set by the grant/oauth-connect middleware during /api/connect/:provider,
    // available here only because this route lives on the same Strapi
    // origin and therefore shares the koa.sess cookie with that step.
    const grantResponse = ctx.session?.grant?.response;
    if (!grantResponse) {
      strapi.log.warn(
        `OAuth bridge callback for "${provider}" had no session grant response (expired session or direct URL visit).`,
      );
      return ctx.redirect(loginErrorUrl);
    }

    try {
      const providersService = strapi.plugin('users-permissions').service('providers');
      const user = await providersService.connect(provider, grantResponse, { grantResponse });

      if (user.blocked) {
        return ctx.redirect(`${frontendUrl()}/login?error=blocked`);
      }

      const jwtService = strapi.plugin('users-permissions').service('jwt');
      const jwt = jwtService.issue({ id: user.id });

      // Done with the OAuth session state; clear it so it can't be replayed.
      ctx.session.grant = {};

      return ctx.redirect(
        `${frontendUrl()}/api/auth/${encodeURIComponent(provider)}/callback?jwt=${encodeURIComponent(jwt)}`,
      );
    } catch (error) {
      strapi.log.error(`OAuth bridge callback for "${provider}" failed:`, error);
      return ctx.redirect(loginErrorUrl);
    }
  },
};
