'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeStory, materializeStory } = require('../src/api/happy-birthday/utils/birthday-story');

const audio = { id: 1, name: 'voice.mp3', url: '/voice.mp3', mime: 'audio/mpeg' };
const video = { id: 2, name: 'message.mp4', url: '/message.mp4', mime: 'video/mp4' };
const photo = { id: 3, name: 'photo.jpg', url: '/photo.jpg', mime: 'image/jpeg' };

test('Story accepts an owned 10-second video or 30-second voice recording and preserves the media type', () => {
  for (const [asset, duration] of [[audio, 30], [video, 10]]) {
    const metadata = { [asset.id]: { duration } };
    const content = normalizeStory({ voiceId: asset.id }, { assets: [asset], metadata });
    const message = materializeStory(content, [asset], metadata).voice;
    assert.equal(content.voiceId, asset.id);
    assert.equal(message.mime, asset.mime);
    assert.equal(message.url, asset.url);
    assert.equal(message.duration, duration);
  }
});

test('Story rejects overlong, missing, invalid and unowned message metadata', () => {
  for (const [asset, limit] of [[audio, 30], [video, 10]]) {
    for (const duration of [undefined, null, 0, -1, NaN, Infinity, limit + .01]) {
      assert.throws(() => normalizeStory({ voiceId: asset.id }, {
        assets: [asset], metadata: { [asset.id]: { duration } },
      }), new RegExp(`${limit} seconds`));
    }
    assert.throws(() => normalizeStory({ voiceId: asset.id }, { assets: [], metadata: { [asset.id]: { duration: limit } } }), /from this story/);
  }
  assert.throws(() => normalizeStory({ voiceId: photo.id }, { assets: [photo] }), /voice or video message/);
  assert.throws(() => normalizeStory({ memories: [{ photoId: video.id, caption: 'Wrong kind', date: '' }] }, { assets: [video] }), /photo/);
  assert.equal(normalizeStory({ voiceId: null }).voiceId, null);
});
