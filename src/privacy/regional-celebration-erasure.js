'use strict';
const { eraseCelebration } = require('./celebration-erasure');
const UID = 'api::happy-birthday.happy-birthday';
function canPermanentlyDelete(country) {
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country) && country !== 'IN' && country !== 'ZZ';
}
function failure(message, status) { return Object.assign(new Error(message), { status }); }
async function eraseOwnedCelebration(strapi, documentId, actorId, country) {
  if (!Number.isInteger(actorId) || actorId <= 0) throw failure('Celebration not found', 404);
  // The internal caller supplies the verified session ID. Re-read its role;
  // never accept a browser/server request-body flag as proof of admin access.
  const actor = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: actorId }, populate: { role: true },
  });
  if (!actor || actor.blocked) throw failure('Celebration not found', 404);
  const isAdmin = actor.role?.type === 'admin';
  if (!isAdmin && !canPermanentlyDelete(country)) throw failure('Permanent delete is not available in this location', 403);
  const entry = await strapi.db.query(UID).findOne({
    where: { documentId, ...(!isAdmin ? { owner: actorId, publishedAt: null } : {}) },
    populate: { owner: { select: ['id'] } },
  });
  if (!entry || (!isAdmin && entry.owner?.id !== actorId)) throw failure('Celebration not found', 404);
  try {
    return await eraseCelebration(strapi, documentId, { allowDemo: isAdmin });
  } catch (error) {
    const pending = await strapi.db.query(UID).findOne({ where: { documentId, erasureRequestedAt: { $notNull: true } } });
    if (!pending) throw error;
    strapi.log.error('Permanent deletion cleanup queued for retry');
    return { documentId, customroute: entry.customroute, erased: false, pending: true };
  }
}
module.exports = { canPermanentlyDelete, eraseOwnedCelebration };
