'use strict';
// Launched only by run-check, with a disposable database and blocked external network.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');
if (process.env.ENV_PATH !== '/dev/null' || !process.env.TMPDIR?.startsWith('/tmp/contenthub-check-') ||
    !['sqlite', 'postgres'].includes(process.env.DATABASE_CLIENT)) throw new Error('Use the isolated regression runner');
if (process.env.DATABASE_CLIENT === 'postgres' && (process.env.DATABASE_HOST !== '127.0.0.1' ||
    process.env.DATABASE_NAME !== 'postgres' || process.env.REGRESSION_DISPOSABLE_POSTGRES !== 'true')) throw new Error('Disposable PostgreSQL required');
let app;
(async () => {
  const publicDir = path.join(process.env.TMPDIR, 'mug-public');
  await fs.mkdir(path.join(publicDir, 'uploads'), { recursive: true });
  if (process.env.DATABASE_CLIENT === 'sqlite') {
    process.env.DATABASE_FILENAME = path.relative(process.cwd(), process.env.DATABASE_FILENAME);
  }
  app = createStrapi({ appDir: process.cwd(), distDir: process.cwd() });
  app.config.set('dirs.static.public', publicDir);
  await app.load();
  app.plugin('email').service('email').send = async () => {};
  const role = await app.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
  const user = await app.db.query('plugin::users-permissions.user').create({ data: {
    username: 'mug-http-user', email: 'mug-http@example.test', provider: 'local', confirmed: true, role: role.id,
  } });
  const jwt = app.plugin('users-permissions').service('jwt').issue({ id: user.id });
  const broad = await app.admin.services['api-token'].create({ name: 'mug-broad-rejected', type: 'full-access', lifespan: null });
  await new Promise((resolve, reject) => {
    app.server.httpServer.once('error', reject); app.server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + app.server.httpServer.address().port + '/api';
  await require('../tests/helpers/shopify-mug-regression.cjs')(app, base, jwt, broad.accessKey);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.destroy();
});
