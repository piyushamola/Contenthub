'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeStory } = require('../src/api/happy-birthday/utils/birthday-story');

test('Story normalization uses Pastel for new and legacy content', () => {
  assert.equal(normalizeStory({}).theme, 'pastel');
  for (const theme of ['pastel', 'classic']) {
    assert.equal(normalizeStory({ theme }).theme, 'pastel');
  }
});

test('Unknown and malformed Story styles are rejected in drafts and publication', () => {
  for (const theme of ['', 'arcade', null, {}, ['pastel'], 1]) {
    for (const complete of [false, true]) {
      assert.throws(() => normalizeStory({ theme }, { complete }), /supported story style/i);
    }
  }
});
