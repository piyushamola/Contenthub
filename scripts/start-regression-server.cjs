'use strict';

// This entry point owns its temporary database. It never boots the application's
// configured development/production database or reads the project's .env file.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { once } = require('node:events');

function argumentsFrom(argv) {
  const allowed = new Set(['port', 'frontend-origin', 'ready-file', 'payments', 'tls-key', 'tls-cert']);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/, '');
    if (!argv[index]?.startsWith('--') || !allowed.has(name) || !argv[index + 1]) {
      throw new Error('Use --port, --frontend-origin, --ready-file, --payments mock|razorpay-test and optional --tls-key/--tls-cert');
    }
    result[name] = argv[index + 1];
  }
  return result;
}

const UID = 'api::happy-birthday.happy-birthday';
const PURCHASE_UID = 'api::celebration-purchase.celebration-purchase';
const PRICING_UID = 'api::premium-pricing.premium-pricing';
let app;
let secureServer;
let temporary;
let readyPath;
let readyPublished = false;
let stopping;

async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    try {
      if (secureServer) {
        secureServer.closeAllConnections();
        await new Promise((resolve) => secureServer.close(resolve));
      }
      if (app) await app.destroy();
    } finally {
      if (readyPublished) await fs.rm(readyPath, { force: true });
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  })();
  return stopping;
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Use Node 22 for the real Strapi regression server');
  const options = argumentsFrom(process.argv.slice(2));
  const port = Number(options.port || 4331);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid loopback server port');
  const mode = options.payments || 'mock';
  if (!['mock', 'razorpay-test'].includes(mode)) throw new Error('Payment mode must be mock or razorpay-test');
  const frontendOrigin = options['frontend-origin'] || 'https://localhost:4332';
  const frontendUrl = new URL(frontendOrigin);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(frontendUrl.hostname)) throw new Error('Frontend origin must use loopback');
  if (!options['ready-file'] || !path.isAbsolute(options['ready-file'])) throw new Error('An absolute --ready-file path is required');
  if (Boolean(options['tls-key']) !== Boolean(options['tls-cert'])) throw new Error('Provide both --tls-key and --tls-cert');
  const tls = options['tls-key'] ? {
    key: await fs.readFile(options['tls-key']), cert: await fs.readFile(options['tls-cert']),
  } : null;
  const providerKeyId = mode === 'mock' ? 'rzp_test_regression' : process.env.REGRESSION_RAZORPAY_KEY_ID;
  const providerSecret = mode === 'mock' ? 'regression-provider-secret' : process.env.REGRESSION_RAZORPAY_KEY_SECRET;
  if (!providerKeyId?.startsWith('rzp_test_') || !providerSecret ||
      (mode === 'razorpay-test' && providerKeyId === 'rzp_test_regression')) {
    throw new Error('Razorpay TEST mode requires explicit REGRESSION_RAZORPAY_KEY_ID beginning rzp_test_ and REGRESSION_RAZORPAY_KEY_SECRET; live credentials are rejected');
  }
  const root = path.resolve(__dirname, '..');
  process.chdir(root);
  temporary = await fs.mkdtemp('/tmp/contenthub-fullstack-');
  const publicDir = path.join(temporary, 'public');
  await fs.mkdir(path.join(publicDir, 'uploads'), { recursive: true });
  const keep = Object.fromEntries(['PATH', 'HOME', 'TZ', 'NODE_EXTRA_CA_CERTS'].filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  for (const name of Object.keys(process.env)) delete process.env[name];
  const webhookSecret = 'regression-webhook-secret';
  Object.assign(process.env, keep, {
    NODE_ENV: 'test', ENV_PATH: '/dev/null', CI: 'true',
    DATABASE_CLIENT: 'sqlite', DATABASE_FILENAME: path.relative(root, path.join(temporary, 'data.sqlite')),
    APP_KEYS: 'regression-key-one,regression-key-two',
    ADMIN_JWT_SECRET: 'regression-admin-secret-not-for-deployment',
    API_TOKEN_SALT: 'regression-api-token-salt', TRANSFER_TOKEN_SALT: 'regression-transfer-salt',
    JWT_SECRET: 'regression-user-jwt-secret-not-for-deployment',
    RAZORPAY_KEY_ID: providerKeyId, RAZORPAY_KEY_SECRET: providerSecret,
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
    HOST: '127.0.0.1', PORT: String(port),
    PUBLIC_URL: `${tls ? 'https' : 'http'}://127.0.0.1:${port}`,
    FRONTEND_URL: frontendOrigin, FRONTEND_RESET_PASSWORD_URL: `${frontendOrigin}/reset-password`,
    NEXT_PUBLIC_SITE_URL: frontendOrigin,
    CELEBRATION_EXPIRY_CRON_ENABLED: 'false', STRAPI_TELEMETRY_DISABLED: 'true',
    STRAPI_HIDE_STARTUP_MESSAGE: 'true', BROWSER: 'none', XDG_CONFIG_HOME: temporary,
  });

  // Block accidental provider/SMTP calls. Only explicit Razorpay TEST mode
  // permits the provider hostname; its credentials have already been checked.
  const allowedHost = (host) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) ||
    (mode === 'razorpay-test' && host === 'api.razorpay.com');
  const { Socket } = require('node:net');
  const originalConnect = Socket.prototype.connect;
  Socket.prototype.connect = function (...args) {
    const value = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (!value || typeof value !== 'object' || !allowedHost(value.host)) throw new Error('External network is disabled for this regression server');
    return originalConnect.apply(this, args);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!allowedHost(url.hostname)) throw new Error('External fetch is disabled for this regression server');
    return originalFetch(input, init);
  };

  const signalListeners = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, process.listeners(signal)]));
  app = require('@strapi/strapi').createStrapi({ appDir: root, distDir: root });
  // Strapi's CLI signal handler calls process.exit immediately after destroy.
  // This launcher must finish deleting its owned files before exiting instead.
  for (const [signal, previous] of signalListeners) {
    for (const listener of process.listeners(signal)) {
      if (!previous.includes(listener)) process.removeListener(signal, listener);
    }
  }
  app.config.set('dirs.static.public', publicDir);
  app.config.set('server.logger.updates.enabled', false);
  app.config.set('admin.secrets.encryptionKey', crypto.randomBytes(32).toString('hex'));
  await app.load();
  // All real Next auth calls reach Strapi from one loopback IP. Allow suite
  // throughput here while keeping rate limiting on and production untouched.
  app.config.set('plugin::users-permissions.ratelimit', {
    ...app.config.get('plugin::users-permissions.ratelimit'), enabled: true, max: 100,
  });
  const outbox = [];
  app.plugin('email').service('email').send = async (mail) => {
    outbox.push({ ...mail, capturedAt: new Date().toISOString() });
    return { accepted: [mail.to] };
  };

  const roles = await app.db.query('plugin::users-permissions.role').findMany({});
  const users = {};
  for (const [name, roleType] of [['creator', 'authenticated'], ['other', 'authenticated'], ['admin', 'admin']]) {
    const role = roles.find((item) => item.type === roleType);
    if (!role) throw new Error(`Missing ${roleType} role`);
    const email = `${name}@example.test`;
    const password = 'Regression-test-123!';
    const user = await app.plugin('users-permissions').service('user').add({
      username: `regression-${name}`, displayName: name === 'creator' ? 'Regression Creator' : `Regression ${name}`,
      email, password, provider: 'local', confirmed: true, blocked: false, role: role.id,
    });
    users[name] = { id: user.id, email, password, displayName: user.displayName, role: roleType };
  }
  await app.documents(PRICING_UID).create({ data: {
    indiaPriceRupees: 9, otherCountriesPriceUsd: 1,
    storyIndiaPriceRupees: 36, storyOtherCountriesPriceUsd: 5,
  } });
  const apiToken = await app.admin.services['api-token'].create({
    name: 'fullstack-regression-server', description: 'Disposable database only', type: 'full-access', lifespan: null,
  });
  const orders = new Map();
  const payments = new Map();
  const providerCalls = [];
  const paymentService = app.service(PURCHASE_UID);
  if (mode === 'mock') {
    paymentService.razorpay = async (endpoint, init = {}) => {
      providerCalls.push({ method: init.method || 'GET', endpoint });
      if (endpoint === '/orders' && init.method === 'POST') {
        const input = JSON.parse(init.body);
        if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || !['INR', 'USD'].includes(input.currency)) throw new Error('Invalid mock provider order');
        const order = { ...input, id: `order_regression${crypto.randomBytes(8).toString('hex')}`, status: 'created' };
        orders.set(order.id, order);
        return order;
      }
      const match = endpoint.match(/^\/(orders|payments)\/([^/]+)(\/payments)?$/);
      if (match?.[1] === 'orders' && match[3]) return { items: [...payments.values()].filter((payment) => payment.order_id === match[2]) };
      const found = match && (match[1] === 'orders' ? orders : payments).get(match[2]);
      if (!found) throw new Error(`Unknown mock provider endpoint: ${endpoint}`);
      return found;
    };
  }
  const controlToken = crypto.randomBytes(32).toString('hex');
  function signedWebhook(event) {
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex') };
  }
  app.server.use(async (ctx, next) => {
    if (!ctx.path.startsWith('/__regression/')) return next();
    if (ctx.get('authorization') !== `Bearer ${controlToken}`) {
      ctx.status = 401; ctx.body = { error: 'Regression control token required' }; return;
    }
    const body = ctx.request.body || {};
    const route = ctx.path.slice('/__regression'.length);
    if (ctx.method === 'GET' && route === '/state') {
      ctx.body = {
        paymentMode: mode, recordCount: await app.db.query(UID).count(),
        uploadCount: await app.db.query('plugin::upload.file').count(), outboxCount: outbox.length,
        provider: mode === 'mock' ? { orderCount: orders.size, paymentCount: payments.size, calls: providerCalls } : null,
      };
      return;
    }
    if (ctx.method === 'GET' && route === '/outbox') {
      ctx.body = { messages: outbox.filter((mail) => !ctx.query.email || JSON.stringify(mail.to).includes(ctx.query.email)) };
      return;
    }
    if (ctx.method === 'GET' && route === '/users') {
      ctx.body = { users: await app.db.query('plugin::users-permissions.user').findMany({
        where: ctx.query.email ? { email: ctx.query.email } : {}, select: ['id', 'email', 'username', 'confirmed', 'blocked'], populate: ['role'],
      }) };
      return;
    }
    const celebrationMatch = route.match(/^\/celebrations\/([^/]+)(\/expire)?$/);
    if (celebrationMatch) {
      const slug = decodeURIComponent(celebrationMatch[1]);
      if (ctx.method === 'POST' && celebrationMatch[2]) {
        await app.db.query(UID).updateMany({ where: { customroute: slug }, data: { expiresAt: new Date(Date.now() - 60_000).toISOString() } });
        ctx.body = { expired: true, cleanup: await app.service(UID).unpublishExpired() };
        return;
      }
      if (ctx.method === 'GET' && !celebrationMatch[2]) {
        const rows = await app.db.query(UID).findMany({ where: { customroute: slug }, populate: { owner: true, images: true, storyAssets: true } });
        const ids = [...new Set(rows.flatMap((row) => [...(row.images || []), ...(row.storyAssets || [])]).map((file) => file.id))];
        // Return safe ownership evidence, never password hashes from the user relation.
        for (const row of rows) if (row.owner) row.owner = { id: row.owner.id, email: row.owner.email, username: row.owner.username };
        ctx.body = { rows, purchases: await app.db.query(PURCHASE_UID).findMany({ where: { celebrationSlug: slug } }),
          media: ids.length ? await app.db.query('plugin::upload.file').findMany({ where: { id: { $in: ids } } }) : [] };
        return;
      }
    }
    const paymentMatch = route.match(/^\/payments\/([^/]+)\/(capture|refund)$/);
    if (paymentMatch && ctx.method === 'POST') {
      if (mode !== 'mock') { ctx.status = 409; ctx.body = { error: 'Provider controls are available only in mock mode' }; return; }
      if (paymentMatch[2] === 'capture') {
        const order = orders.get(paymentMatch[1]);
        if (!order) { ctx.status = 404; ctx.body = { error: 'Order not found' }; return; }
        const payment = {
          id: body.paymentId || `pay_regression${crypto.randomBytes(8).toString('hex')}`,
          order_id: order.id, amount: body.amount ?? order.amount, currency: body.currency || order.currency,
          status: 'captured', amount_refunded: 0, created_at: Math.floor(Date.now() / 1000),
        };
        payments.set(payment.id, payment);
        order.status = 'paid';
        const event = { event: 'payment.captured', payload: { payment: { entity: payment } } };
        ctx.body = { orderId: order.id, paymentId: payment.id,
          signature: crypto.createHmac('sha256', providerSecret).update(`${order.id}|${payment.id}`).digest('hex'),
          eventId: `event_${crypto.randomUUID()}`, webhook: signedWebhook(event) };
      } else {
        const payment = payments.get(paymentMatch[1]);
        if (!payment) { ctx.status = 404; ctx.body = { error: 'Payment not found' }; return; }
        payment.amount_refunded = body.amount ?? payment.amount;
        payment.status = payment.amount_refunded >= payment.amount ? 'refunded' : 'captured';
        const event = { event: 'refund.processed', payload: { refund: { entity: {
          id: `rfnd_${crypto.randomUUID()}`, payment_id: payment.id, status: 'processed', amount: payment.amount_refunded,
        } } } };
        ctx.body = { paymentId: payment.id, eventId: `event_${crypto.randomUUID()}`, webhook: signedWebhook(event) };
      }
      return;
    }
    ctx.status = 404; ctx.body = { error: 'Unknown regression control' };
  });

  let server;
  if (tls) {
    app.server.mount();
    secureServer = https.createServer(tls, app.server.app.callback());
    server = secureServer;
    server.listen(port, '127.0.0.1');
  } else {
    server = app.server.httpServer;
    app.server.listen(port, '127.0.0.1');
  }
  await once(server, 'listening');
  const cmsUrl = `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
  app.config.set('server.url', cmsUrl);
  const ready = {
    version: 1, cmsUrl, paymentMode: mode, users,
    frontendEnv: {
      CMS_URL: cmsUrl, STRAPI_URL: cmsUrl, AUTHORIZATION_TOKEN: apiToken.accessKey,
      PAYMENTS_AUTHORIZATION_TOKEN: apiToken.accessKey, RAZORPAY_KEY_ID: providerKeyId,
      NEXT_PUBLIC_RAZORPAY_KEY_ID: providerKeyId, RAZORPAY_WEBHOOK_SECRET: webhookSecret,
    },
    control: { baseUrl: `${cmsUrl}/__regression`, token: controlToken },
  };
  readyPath = options['ready-file'];
  await fs.mkdir(path.dirname(readyPath), { recursive: true });
  await fs.writeFile(`${readyPath}.tmp`, JSON.stringify(ready, null, 2), { mode: 0o600, flag: 'wx' });
  await fs.rename(`${readyPath}.tmp`, readyPath);
  readyPublished = true;
  console.log(`REGRESSION_READY ${cmsUrl} (${mode})`);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop().then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); }));
main().catch(async (error) => {
  console.error(`Regression server failed: ${error.message}`);
  await stop().catch((cleanupError) => console.error(cleanupError.message));
  process.exitCode = 1;
});
