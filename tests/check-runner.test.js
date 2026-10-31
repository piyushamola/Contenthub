'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const runner = fs.readFileSync(path.join(__dirname, '../scripts/run-check.cjs'), 'utf8');

function runWithChildResult(result) {
  const errors = [];
  const removed = [];
  const childCalls = [];
  const isolatedProcess = {
    versions: { node: '22.18.0' },
    execPath: '/test-runtime/node',
    argv: ['node', 'scripts/run-check.cjs', 'unit'],
    env: { PATH: '/test-runtime' },
    exitCode: undefined,
  };
  vm.runInNewContext(runner, {
    __dirname: '/test-workspace/scripts',
    process: isolatedProcess,
    console: { error: message => errors.push(message) },
    require: name => {
      if (name === 'node:fs') return {
        mkdtempSync: () => '/tmp/isolated-check-fixture',
        readdirSync: () => [],
        rmSync: directory => removed.push(directory),
      };
      if (name === 'node:child_process') return {
        spawnSync: (...args) => { childCalls.push(args); return result; },
      };
      if (name === 'node:path') return path;
      throw new Error(`Unexpected runner dependency: ${name}`);
    },
  });
  assert.equal(childCalls.length, 1);
  assert.deepEqual(removed, ['/tmp/isolated-check-fixture'], 'Disposable files must be cleaned up after success and failure');
  return { exitCode: isolatedProcess.exitCode, errors };
}

test('the regression gate succeeds only after a clean child exit', () => {
  assert.equal(runWithChildResult({ status: 0, signal: null }).exitCode, 0);
  assert.equal(runWithChildResult({ status: 1, signal: null }).exitCode, 1);
  assert.equal(runWithChildResult({ status: null, signal: 'SIGKILL' }).exitCode, 1);
});

test('a timeout fails the gate even if the child handles termination and exits zero', () => {
  const error = Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const result = runWithChildResult({ status: 0, signal: null, error });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.errors, [error.message]);
});

test('failure to start a child fails the gate and reports the process error', () => {
  const error = Object.assign(new Error('spawnSync node ENOENT'), { code: 'ENOENT' });
  const result = runWithChildResult({ status: null, signal: null, error });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.errors, [error.message]);
});

test('the PostgreSQL integration gate starts a disposable loopback cluster and ignores inherited database credentials', () => {
  const childCalls = [];
  const removed = [];
  const isolatedProcess = {
    versions: { node: '22.23.4' }, execPath: '/test-runtime/node',
    argv: ['node', 'scripts/run-check.cjs', 'integration-postgres'],
    env: { PATH: '/test-runtime', DATABASE_HOST: 'production.invalid',
      DATABASE_URL: 'postgres://never-use-this.invalid/customer-data', DATABASE_USERNAME: 'production' },
    exitCode: undefined,
  };
  vm.runInNewContext(runner, {
    __dirname: '/test-workspace/scripts', process: isolatedProcess,
    console: { error(message) { throw new Error(message); } },
    require: name => {
      if (name === 'node:fs') return {
        mkdtempSync: () => '/tmp/isolated-check-fixture',
        existsSync: filename => filename.endsWith('/initdb'),
        mkdirSync() {}, rmSync: directory => removed.push(directory),
      };
      if (name === 'node:child_process') return {
        spawnSync: (...args) => {
          childCalls.push(args);
          return { status: 0, signal: null, stdout: args[1][0] === '-e' ? '55432\n' : '' };
        },
      };
      if (name === 'node:path') return path;
      throw new Error(`Unexpected runner dependency: ${name}`);
    },
  });
  assert.equal(isolatedProcess.exitCode, 0);
  assert.equal(childCalls.length, 5);
  const [node, args, options] = childCalls[3];
  assert.equal(node, '/test-runtime/node');
  assert.equal(args.at(-1), 'scripts/test-birthday-story.cjs');
  assert.equal(options.env.DATABASE_CLIENT, 'postgres');
  assert.equal(options.env.DATABASE_HOST, '127.0.0.1');
  assert.equal(options.env.DATABASE_PORT, '55432');
  assert.equal(options.env.DATABASE_USERNAME, 'regression');
  assert.equal(options.env.DATABASE_URL, undefined);
  assert.equal(options.env.REGRESSION_DISPOSABLE_POSTGRES, 'true');
  assert.equal(options.env.ENV_PATH, '/dev/null');
  assert.equal(childCalls[1][1][0], '-D');
  assert.equal(childCalls[2][1].at(-1), 'start');
  assert.equal(childCalls[4][1].at(-1), 'stop');
  assert.deepEqual(removed, ['/tmp/isolated-check-fixture']);
});
