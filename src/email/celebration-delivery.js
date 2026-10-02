'use strict';

const UID = 'api::celebration-email-delivery.celebration-email-delivery';
const CELEBRATION_UID = 'api::happy-birthday.happy-birthday';

async function claim(strapi, documentId, deliveryStatus) {
  const deliveries = strapi.db.query(UID);
  if (await deliveries.findOne({ where: { celebrationDocumentId: documentId } })) return null;
  try {
    return await deliveries.create({ data: { celebrationDocumentId: documentId, deliveryStatus } });
  } catch (error) {
    // The database unique constraint also covers concurrent publications/workers.
    if (await deliveries.findOne({ where: { celebrationDocumentId: documentId } })) return null;
    throw error;
  }
}

async function sendOnce(strapi, event, send) {
  if (!event?.publishedAt || !event.documentId) return;
  // Read committed content; a rolled-back/deleted publication must not send mail.
  const entry = await strapi.db.query(CELEBRATION_UID).findOne({
    where: { documentId: event.documentId, publishedAt: { $notNull: true } },
  });
  if (!entry?.hostemail || !entry.hostname || !entry.personname || !entry.customroute) return;
  const delivery = await claim(strapi, event.documentId, 'claimed');
  if (!delivery) return;
  try {
    await send(entry);
    await strapi.db.query(UID).update({
      where: { id: delivery.id },
      data: { deliveryStatus: 'sent', sentAt: new Date().toISOString() },
    });
  } catch (error) {
    // Do not blindly resend: SMTP can accept a message before reporting an error.
    await strapi.db.query(UID).update({ where: { id: delivery.id }, data: { deliveryStatus: 'failed' } });
    strapi.log.error(`Celebration confirmation email failed for document "${event.documentId}":`, error);
  }
}

/** Existing publications must not receive another welcome email after deployment. */
async function rememberExistingPublications(strapi) {
  let lastId = 0;
  for (;;) {
    const entries = await strapi.db.query(CELEBRATION_UID).findMany({
      where: { id: { $gt: lastId }, publishedAt: { $notNull: true } },
      select: ['id', 'documentId'], orderBy: { id: 'asc' }, limit: 100,
    });
    if (!entries.length) return;
    for (const entry of entries) await claim(strapi, entry.documentId, 'existing');
    lastId = entries[entries.length - 1].id;
  }
}

module.exports = { sendOnce, rememberExistingPublications, UID };
