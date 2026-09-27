'use strict';
process.env.NODE_ENV = 'development';
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const app = await createStrapi(await compileStrapi()).load();
  const existing = await app.query('admin::api-token').findOne({ where: { name: 'local-e2e-test-token' } });
  if (existing) await app.query('admin::api-token').delete({ where: { id: existing.id } });
  const token = await app.service('admin::api-token').create({ name: 'local-e2e-test-token', type: 'full-access', lifespan: null });
  console.log('TOKEN_START');
  console.log(token.accessKey);
  console.log('TOKEN_END');
  await app.destroy();
  process.exit(0);
}
main();
