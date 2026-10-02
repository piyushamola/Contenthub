'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { REPLY_TO, applyAuthReplyTo } = require('../src/email/settings');

test('auth Reply-To is repaired even when the sender address is already correct', () => {
  const settings = {
    email_confirmation: { options: { from: { email: 'sender@example.test' }, response_email: '' } },
    reset_password: { options: { from: { email: 'sender@example.test' }, response_email: 'old@example.test' } },
  };
  assert.equal(applyAuthReplyTo(settings), true);
  for (const value of Object.values(settings)) {
    assert.equal(value.options.response_email, REPLY_TO);
    assert.equal(value.options.from.email, 'sender@example.test');
  }
  assert.equal(applyAuthReplyTo(settings), false);
});

test('all email provider environments use the support Reply-To address', () => {
  for (const path of ['../config/plugins', '../config/env/production/plugins', '../config/env/development/plugins']) {
    const config = require(path)({ env: (_key, fallback) => fallback });
    assert.equal(config.email.config.settings.defaultReplyTo, REPLY_TO);
  }
});
