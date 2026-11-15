'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStandardEdit, splitMessages, revision, uploadPrefix } = require('../src/api/happy-birthday/utils/standard-edit');
const valid = () => ({ forName: ' Birthday Friend ', personEmail: ' friend@example.invalid ', headline: ' A personal birthday greeting. ', captions: [' First memory ', 'Second memory', 'Third memory'], imageIds: [3, 1, 2] });
test('owner changes normalize text and preserve explicit photo order', () => {
  const result = normalizeStandardEdit(valid());
  assert.equal(result.forName, 'Birthday Friend'); assert.equal(result.personEmail, 'friend@example.invalid');
  assert.equal(result.headline, 'A personal birthday greeting.'); assert.deepEqual(result.captions, ['First memory', 'Second memory', 'Third memory']);
  assert.deepEqual(result.imageIds, [3, 1, 2]);
});
test('owner changes reject immutable fields, incomplete media and invalid recipient/messages', () => {
  for (const field of ['slug', 'owner', 'country', 'expiresAt', 'triggerAt', 'templateId', 'musicId', 'premiumUnlocked', 'premiumPaymentId', 'celebrationStatus'])
    assert.throws(() => normalizeStandardEdit({ ...valid(), [field]: 'forged' }), error => error.status === 400);
  for (const patch of [{ forName: '' }, { forName: 'a\nname' }, { personEmail: 'bad-address' }, { headline: 'tiny' }, { headline: 'x'.repeat(4001) }, { captions: ['one'] }, { captions: ['first', '', 'third'] }, { imageIds: [1, 1, 2] }, { imageIds: [1, 2] }, { imageIds: [1, 2, -1] }, { imageIds: [1, 2, '3'] }])
    assert.throws(() => normalizeStandardEdit({ ...valid(), ...patch }), error => error.status === 400);
  assert.throws(() => normalizeStandardEdit({ ...valid(), headline: '__wishhappybday_experience:premium' }), error => error.status === 400);
  for (const value of [-1, 1.5, '0', null]) assert.throws(() => revision(value), error => error.status === 400);
  assert.equal(revision(0), 0);
});
test('legacy messages retain their existing headline/caption interpretation and experience marker', () => {
  assert.deepEqual(splitMessages(JSON.stringify(['Greeting', 'First', 'Second', 'Third', '__wishhappybday_experience:premium'])), {
    headline: 'Greeting', captions: ['First', 'Second', 'Third'], markers: ['__wishhappybday_experience:premium'],
  });
  assert.deepEqual(splitMessages(['First', 'Second', 'Third']), { headline: 'First', captions: ['First', 'Second', 'Third'], markers: [] });
  assert.deepEqual(splitMessages(null), { headline: '', captions: ['', '', ''], markers: [] });
});
test('upload scope is stable for the same owner/document and distinct for other owners/documents', () => {
  const prefix = uploadPrefix('document-a', 17);
  assert.match(prefix, /^standard-edit-[a-f0-9]{24}-$/);
  assert.equal(prefix, uploadPrefix('document-a', 17));
  assert.notEqual(prefix, uploadPrefix('document-a', 18)); assert.notEqual(prefix, uploadPrefix('document-b', 17));
});
