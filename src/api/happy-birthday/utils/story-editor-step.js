'use strict';
function storyEditorStep(value, fallback = 0) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > 7) throw new Error('Invalid story step');
  return value;
}
module.exports = { storyEditorStep };
