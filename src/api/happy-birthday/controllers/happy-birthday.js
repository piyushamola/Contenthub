'use strict';

/**
 * happy-birthday controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::happy-birthday.happy-birthday';

const DASHBOARD_POPULATE = {
  images: { select: ['id', 'url', 'name'] },
  owner: { select: ['id', 'username', 'displayName', 'email'] },
};

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;

function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE),
  );
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 120) : '';
  return { page, pageSize, search };
}

async function findDashboardPage(strapi, where, { page, pageSize }) {
  const [entries, total] = await Promise.all([
    strapi.db.query(UID).findMany({
      where,
      populate: DASHBOARD_POPULATE,
      orderBy: { createdAt: 'desc' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    strapi.db.query(UID).count({ where }),
  ]);

  return {
    data: entries.map(serializeForDashboard),
    meta: {
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    },
  };
}

function serializeForDashboard(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    documentId: entry.documentId,
    personname: entry.personname,
    customroute: entry.customroute,
    hostname: entry.hostname,
    hostemail: entry.hostemail,
    // Exposed as `status` in the API response for a simpler client shape,
    // even though the underlying attribute is `celebrationStatus` (Strapi
    // reserves the plain "status" attribute name when draftAndPublish is
    // enabled, since it collides with the Document Service's own
    // ?status=draft|published query parameter).
    status: entry.celebrationStatus || 'active',
    expiresAt: entry.expiresAt,
    premiumUnlocked: Boolean(entry.premiumUnlocked),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    images: Array.isArray(entry.images) ? entry.images : [],
    owner: entry.owner
      ? {
          id: entry.owner.id,
          username: entry.owner.username,
          displayName: entry.owner.displayName || null,
          email: entry.owner.email,
        }
      : null,
  };
}

async function setCelebrationStatus(strapi, documentId, celebrationStatus) {
  // Strapi keeps a separate draft row alongside the published one for every
  // document (even ones created directly as published) — the Strapi admin
  // panel's Content Manager shows the DRAFT row by default. Updating only
  // the published row (as this used to do) left the draft stuck on its
  // original value forever, so admins would always see "Active" there no
  // matter how many times a celebration was paused/resumed. Updating by
  // documentId alone (no publishedAt filter) keeps both rows in sync.
  const updated = await strapi.db.query(UID).updateMany({
    where: { documentId },
    data: { celebrationStatus },
  });
  if (!updated?.count) return null;

  return strapi.db.query(UID).findOne({
    where: { documentId, publishedAt: { $notNull: true } },
    populate: DASHBOARD_POPULATE,
  });
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async mine(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Login required');

    const { page, pageSize } = parsePagination(ctx.query);
    const where = { owner: userId, publishedAt: { $notNull: true } };
    ctx.body = await findDashboardPage(strapi, where, { page, pageSize });
  },

  async all(ctx) {
    const { page, pageSize, search } = parsePagination(ctx.query);
    const where = {
      publishedAt: { $notNull: true },
      ...(search ? { customroute: { $containsi: search } } : {}),
    };
    ctx.body = await findDashboardPage(strapi, where, { page, pageSize });
  },

  async pause(ctx) {
    const entry = await setCelebrationStatus(strapi, ctx.params.documentId, 'paused');
    if (!entry) return ctx.notFound('Celebration not found');
    ctx.body = { data: serializeForDashboard(entry) };
  },

  async resume(ctx) {
    const entry = await setCelebrationStatus(strapi, ctx.params.documentId, 'active');
    if (!entry) return ctx.notFound('Celebration not found');
    ctx.body = { data: serializeForDashboard(entry) };
  },

  async deleteCelebration(ctx) {
    const { documentId } = ctx.params;
    const existing = await strapi.db.query(UID).findOne({
      where: { documentId, publishedAt: { $notNull: true } },
      select: ['documentId', 'customroute'],
    });
    if (!existing) return ctx.notFound('Celebration not found');

    await strapi.service(UID).unpublishCelebration(documentId);
    ctx.body = {
      data: { documentId, customroute: existing.customroute, unpublished: true },
    };
  },
}));
