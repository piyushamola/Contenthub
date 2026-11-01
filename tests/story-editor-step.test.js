'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { storyEditorStep } = require('../src/api/happy-birthday/utils/story-editor-step');
test('saved editor steps accept each chapter, preserve omitted values and reject invalid input', () => {
  for (let step = 0; step < 8; step++) assert.equal(storyEditorStep(step), step);
  assert.equal(storyEditorStep(undefined), 0);
  assert.equal(storyEditorStep(undefined, 4), 4);
  for (const value of [-1, 8, 1.5, '2', null, {}, [], NaN]) assert.throws(() => storyEditorStep(value), /Invalid story step/);
});
