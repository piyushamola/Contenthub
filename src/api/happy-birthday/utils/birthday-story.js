'use strict';

const MAX_ITEMS = 5;
const INTERNAL_DRAFT_ROUTE = /^story-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED = new Set([
  'about',
  'admin',
  'api',
  'birthday-message-generator',
  'blog',
  'contact',
  'create',
  'dashboard',
  'delivery-policy',
  'faq',
  'forgot-password',
  'gallery',
  'gifts',
  'login',
  'music',
  'opengraph-image',
  'preview',
  'pricing',
  'privacy',
  'refund-policy',
  'register',
  'reset-password',
  'templates',
  'terms',
  'twitter-image',
  'demo',
  'wish',
  'elena',
  'matt',
  'mike',
]);

function fail(message) {
  throw new Error(message);
}
function isInternalStoryDraftRoute(slug) {
  return INTERNAL_DRAFT_ROUTE.test(slug || '');
}
function isInternalStoryDraftLink(entry) {
  return entry?.journeyType === 'story' &&
    !entry.storyFirstPublishedAt &&
    isInternalStoryDraftRoute(entry.customroute) &&
    (!entry.storyContent?.slug || entry.storyContent.slug === entry.customroute);
}
function text(value, limit, label, required) {
  if (typeof value !== 'string') value = '';
  value = value.trim();
  if (value.length > limit)
    fail(`${label} must be ${limit} characters or fewer`);
  if (required && !value) fail(`Add ${label.toLowerCase()}`);
  return value;
}
function list(value, label, min, complete) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_ITEMS ||
    (complete && value.length < min)
  ) {
    fail(`${label} must contain ${min}–${MAX_ITEMS} items`);
  }
  return value;
}

/** Accept partial drafts, but apply the full contract before payment/publication. */
function normalizeStory(
  input,
  { complete = false, assets = [], metadata = {} } = {},
) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('Invalid story');
  const owned = new Map(assets.map((asset) => [asset.id, asset]));
  const media = (id, kind, required) => {
    if (id == null && !required) return null;
    const asset = owned.get(id);
    if (!asset || !asset.mime?.startsWith(`${kind}/`))
      fail(
        `Choose an uploaded ${kind === 'image' ? 'photo' : 'voice message'} from this story`,
      );
    if (
      kind === 'audio' &&
      !(metadata[id]?.duration > 0 && metadata[id].duration <= 30)
    )
      fail('Voice message must be 30 seconds or shorter');
    return id;
  };
  const slug = text(input.slug, 80, 'Link name', complete).toLowerCase();
  if (slug && (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug) || RESERVED.has(slug)))
    fail(
      'Choose a different link name using at least 3 lowercase letters, numbers, or hyphens',
    );
  const quizEnabled = input.quizEnabled === true;
  const quiz = list(input.quiz || [], 'Quiz', 2, complete && quizEnabled).map(
    (q) => {
      if (
        !q ||
        !Array.isArray(q.choices) ||
        q.choices.length < 2 ||
        q.choices.length > 4
      )
        fail('Each question needs 2–4 choices');
      const required = complete && quizEnabled;
      const choices = q.choices.map((choice) =>
        text(choice, 120, 'Answer choice', required),
      );
      if (
        !Number.isInteger(q.correctIndex) ||
        q.correctIndex < 0 ||
        q.correctIndex >= choices.length
      )
        fail('Mark one correct answer for each question');
      if (
        required &&
        new Set(choices.map((v) => v.toLowerCase())).size !== choices.length
      )
        fail('Answer choices must be different');
      return {
        question: text(q.question, 240, 'Quiz question', required),
        choices,
        correctIndex: q.correctIndex,
      };
    },
  );
  return {
    version: 1,
    forName: text(input.forName, 80, 'Recipient name', complete),
    hostName: text(input.hostName, 80, 'Your name', complete),
    slug,
    musicId: text(input.musicId, 100, 'Music', false),
    intro: text(input.intro, 400, 'Opening message', complete),
    greeting: text(input.greeting, 240, 'Balloon greeting', complete),
    cakeMessage: text(input.cakeMessage, 500, 'Cake message', complete),
    letter: text(input.letter, 1800, 'Envelope letter', complete),
    reasons: list(input.reasons || [], 'Reasons', 3, complete).map((v) =>
      text(v, 240, 'Personal reason', complete),
    ),
    memories: list(input.memories || [], 'Memories', 3, complete).map((m) => {
      if (!m || typeof m !== 'object') fail('Invalid memory');
      const date = text(m.date, 10, 'Memory date', false);
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        fail('Choose a valid memory date');
      return {
        photoId: media(m.photoId, 'image', complete),
        caption: text(m.caption, 600, 'Memory caption', complete),
        date,
      };
    }),
    voiceId: media(input.voiceId, 'audio', false),
    scratchMessage: text(
      input.scratchMessage,
      500,
      'Scratch-card message',
      complete,
    ),
    quizEnabled,
    quiz,
  };
}

function materializeStory(content, assets, metadata) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const photo = (id) => {
    const a = byId.get(id);
    return a ? { id: a.id, url: a.url, name: a.name } : null;
  };
  return {
    ...content,
    memories: content.memories.map((m) => ({ ...m, photo: photo(m.photoId) })),
    voice: content.voiceId
      ? {
          ...photo(content.voiceId),
          duration: metadata[content.voiceId]?.duration,
        }
      : null,
    quiz: content.quizEnabled ? content.quiz : [],
  };
}

function storyExpired(entry, now = Date.now()) {
  return Boolean(
    entry.storyExpiredAt ||
      (entry.storyFirstPublishedAt && Date.parse(entry.expiresAt) <= now),
  );
}

module.exports = { normalizeStory, materializeStory, storyExpired, isInternalStoryDraftLink, isInternalStoryDraftRoute };
