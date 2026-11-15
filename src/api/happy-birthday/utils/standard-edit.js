'use strict';
const { createHash } = require('node:crypto');

class StandardEditError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new StandardEditError(status, message); };
const positiveId = value => Number.isSafeInteger(value) && value > 0;
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail(400, 'Invalid celebration revision');
  return value;
}
function text(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || value.includes('\0') || value.trim().startsWith('__wishhappybday_experience:'))
    fail(400, `Check ${label}`);
  return value.trim();
}
function normalizeStandardEdit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid celebration changes');
  const allowed = new Set(['forName', 'personEmail', 'headline', 'captions', 'imageIds']);
  if (Object.keys(input).some(key => !allowed.has(key))) fail(400, 'Only the recipient, messages and photos can change');
  const forName = text(input.forName, 'the birthday person\'s name (1–80 characters)', 1, 80);
  if (/[\u0000-\u001f\u007f]/.test(forName)) fail(400, 'Check the birthday person\'s name');
  const personEmail = text(input.personEmail, 'the recipient email', 3, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personEmail)) fail(400, 'Enter a valid recipient email');
  const headline = text(input.headline, 'the birthday greeting (5–4000 characters)', 5, 4000);
  if (!Array.isArray(input.captions) || input.captions.length !== 3) fail(400, 'Add three photo messages');
  const captions = input.captions.map(value => text(value, 'each photo message (3–2000 characters)', 3, 2000));
  if (!Array.isArray(input.imageIds) || input.imageIds.length !== 3 || input.imageIds.some(value => !positiveId(value)) || new Set(input.imageIds).size !== 3)
    fail(400, 'Choose three different photos');
  return { forName, personEmail, headline, captions, imageIds: [...input.imageIds] };
}
function messages(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = [value]; } }
  return (Array.isArray(value) ? value : []).filter(item => typeof item === 'string');
}
function splitMessages(value) {
  const all = messages(value);
  const markers = all.filter(item => item.startsWith('__wishhappybday_experience:'));
  const visible = all.filter(item => !item.startsWith('__wishhappybday_experience:'));
  return { headline: visible[0] || '', captions: Array.from({ length: 3 }, (_, i) => visible.length > 3 ? visible[i + 1] || '' : visible[i] || ''), markers };
}
function uploadPrefix(documentId, ownerId) {
  return `standard-edit-${createHash('sha256').update(`${documentId}:${ownerId}`).digest('hex').slice(0, 24)}-`;
}
module.exports = { StandardEditError, fail, revision, positiveId, normalizeStandardEdit, splitMessages, uploadPrefix };
