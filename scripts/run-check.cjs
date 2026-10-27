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
if (!['unit', 'integration', 'server', 'build', 'mug', 'mug-postgres'].includes(mode)) {
  console.error('Usage: node scripts/run-check.cjs unit|integration|server|build|mug|mug-postgres');
  process.exit(1);
}

const selected = process.argv.slice(3);
if (selected.some((name) => !/^[a-z0-9-]+$/.test(name)) || (selected.length && mode !== 'unit')) {
  throw new Error('Only unit test basenames may be selected');
}
const root = path.resolve(__dirname, '..');
for (const name of selected) {
  if (!fs.existsSync(path.join(root, 'tests', name + '.test.js'))) throw new Error('Unknown unit test basename');
}
const temporary = fs.mkdtempSync('/tmp/contenthub-check-');
const env = {
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
  LC_ALL: 'C',
  LANG: 'C',
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
let postgres;
function startPostgres() {
  // Never connect to an existing database or inherit database credentials.
  const bin = process.env.REGRESSION_PG_BIN || (fs.existsSync('/opt/homebrew/opt/postgresql@16/bin/initdb')
    ? '/opt/homebrew/opt/postgresql@16/bin' : '');
  const executable = name => bin ? path.join(bin, name) : name;
  const data = path.join(temporary, 'pgdata');
  const socket = path.join(temporary, 'pgsocket');
  fs.mkdirSync(socket);
  const allocate = spawnSync(process.execPath, ['-e', `const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})`], { env, encoding: 'utf8' });
  const port = Number(allocate.stdout?.trim());
  if (!Number.isInteger(port) || port < 1024) throw new Error('Cannot allocate disposable PostgreSQL port');
  const run = (command, args) => {
    const result = spawnSync(executable(command), args, { env, encoding: 'utf8', timeout: 30_000 });
    if (result.error || result.status !== 0) throw new Error('Disposable PostgreSQL ' + command + ' failed: ' + (result.error?.message || result.stderr));
  };
  run('initdb', ['-D', data, '-U', 'regression', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  postgres = { executable, data };
  run('pg_ctl', ['-D', data, '-l', path.join(temporary, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${socket}`, '-w', 'start']);
  Object.assign(env, { DATABASE_CLIENT: 'postgres', DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(port),
    DATABASE_NAME: 'postgres', DATABASE_USERNAME: 'regression', DATABASE_PASSWORD: 'unused-disposable',
    DATABASE_SSL: 'false', REGRESSION_DISPOSABLE_POSTGRES: 'true' });
}
try {
  if (mode === 'mug-postgres') startPostgres();
  const args = mode === 'unit'
    ? ['--require', offline, '--test', ...fs.readdirSync(path.join(root, 'tests'))
        .filter((name) => name.endsWith('.test.js') && (!selected.length || selected.includes(name.slice(0, -8)))).sort()
        .map((name) => path.join(root, 'tests', name))]
    : mode === 'mug' || mode === 'mug-postgres'
      ? ['--require', offline, 'scripts/test-shopify-mug.cjs']
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
  // A child can catch the timeout's termination signal and exit zero. The
  // spawn error still means this check did not complete successfully.
  process.exitCode = !result.error && !result.signal && result.status === 0 ? 0 : 1;
} finally {
  if (postgres) {
    const stopped = spawnSync(postgres.executable('pg_ctl'), ['-D', postgres.data, '-m', 'immediate', '-w', 'stop'], { env, encoding: 'utf8', timeout: 30_000 });
    if ((stopped.error || stopped.status !== 0) && fs.existsSync(path.join(postgres.data, 'postmaster.pid'))) {
      console.error('Disposable PostgreSQL cleanup failed; retained directory: ' + temporary);
      process.exitCode = 1;
    } else postgres = null;
  }
  if (!postgres) fs.rmSync(temporary, { recursive: true, force: true });
}
