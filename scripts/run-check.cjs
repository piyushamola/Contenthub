'use strict';

// Do not inherit database URLs, provider credentials, NODE_OPTIONS, or .env.
// Every check must be safe to run from a developer shell with production access.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (Number(process.versions.node.split('.')[0]) !== 22) {
  console.error('Regression checks require Node 22 (see package.json engines).');
  process.exit(1);
}

const mode = process.argv[2];
if (!['unit', 'integration', 'server', 'build'].includes(mode)) {
  console.error('Usage: node scripts/run-check.cjs unit|integration|server|build');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync('/tmp/contenthub-check-');
const env = {
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
  XDG_CONFIG_HOME: temporary,
  TMPDIR: temporary,
  CI: 'true',
  NODE_ENV: mode === 'build' ? 'production' : 'test',
  ENV_PATH: '/dev/null',
  DATABASE_CLIENT: 'sqlite',
  DATABASE_FILENAME: path.join(temporary, 'test.sqlite'),
  APP_KEYS: 'regression-only-key-one,regression-only-key-two',
  ADMIN_JWT_SECRET: 'regression-only-admin-secret-not-for-deployment',
  API_TOKEN_SALT: 'regression-only-api-salt',
  TRANSFER_TOKEN_SALT: 'regression-only-transfer-salt',
  JWT_SECRET: 'regression-only-jwt-secret-not-for-deployment',
  ENCRYPTION_KEY: 'regression-only-encryption-key-32',
  RAZORPAY_KEY_ID: 'rzp_test_regression',
  RAZORPAY_KEY_SECRET: 'regression-only-razorpay-secret',
  BIRTHDAY_STORY_SERVER_TOKEN: 'regression-only-story-server-token',
  PUBLIC_URL: 'http://127.0.0.1:1337',
  FRONTEND_URL: 'http://127.0.0.1:3000',
  CELEBRATION_EXPIRY_CRON_ENABLED: 'false',
  STRAPI_TELEMETRY_DISABLED: 'true',
  STRAPI_DISABLE_UPDATE_NOTIFICATION: 'true',
  STRAPI_HIDE_STARTUP_MESSAGE: 'true',
  BROWSER: 'none',
};

const offline = path.join(root, 'tests/helpers/offline.cjs');
try {
  const args = mode === 'unit'
    ? ['--require', offline, '--test', ...fs.readdirSync(path.join(root, 'tests'))
        .filter((name) => name.endsWith('.test.js')).sort()
        .map((name) => path.join(root, 'tests', name))]
    : mode === 'integration'
      ? ['--require', offline, 'scripts/test-birthday-story.cjs']
      : mode === 'server'
        ? ['--require', offline, 'scripts/test-regression-server.cjs']
      : [fs.realpathSync(path.join(root, 'node_modules/.bin/strapi')), 'build'];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    timeout: mode === 'build' ? 10 * 60_000 : 5 * 60_000,
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status === 0 ? 0 : 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
