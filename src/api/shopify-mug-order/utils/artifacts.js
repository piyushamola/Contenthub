'use strict';
const { randomBytes, createHash, createCipheriv, createDecipheriv } = require('node:crypto');
const sharp = require('sharp');
const UID = 'api::mug-artifact.mug-artifact';
function key() {
  const value = process.env.MUG_ARTIFACT_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('configuration');
  return Buffer.from(value, 'hex');
}
async function saveArtifact(strapi, encoded, artwork) {
  if (typeof encoded !== 'string' || encoded.length > 33_333_336 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('invalid_asset');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 25_000_000 || bytes.toString('base64') !== encoded) throw new Error('invalid_asset');
  const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
  let metadata;
  try {
    metadata = await image.metadata();
    if (!['png','jpeg'].includes(metadata.format) || (metadata.pages || 1) !== 1 || (metadata.orientation || 1) !== 1 ||
      !metadata.width || !metadata.height || (artwork && (metadata.width !== 2550 || metadata.height !== 1050))) throw new Error();
    await image.raw().toBuffer();
  } catch { throw new Error('invalid_asset'); }
  const digest = createHash('sha256').update(bytes).digest('hex');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const encryptedBytes = Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  const query = strapi.db.query(UID);
  let row = await query.findOne({ where: { digest } });
  const retainUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
  if (!row) {
    try { row = await query.create({ data: { documentId: randomBytes(12).toString('hex'), digest, encryptedBytes,
      mime: 'image/' + metadata.format, byteLength: bytes.length, width: metadata.width, height: metadata.height, retainUntil } }); }
    catch (error) { row = await query.findOne({ where: { digest } }); if (!row) throw error; }
  } else await query.update({ where: { id: row.id }, data: { retainUntil } });
  return digest;
}
async function readArtifact(strapi, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('invalid_asset');
  const row = await strapi.db.query(UID).findOne({ where: { digest } });
  if (!row || Date.parse(row.retainUntil) <= Date.now()) throw new Error('asset_expired');
  try {
    const encoded = Buffer.from(row.encryptedBytes, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', key(), encoded.subarray(0,12)); cipher.setAuthTag(encoded.subarray(12,28));
    const bytes = Buffer.concat([cipher.update(encoded.subarray(28)), cipher.final()]);
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error();
    return { mime: row.mime, bytes: bytes.toString('base64'), digest };
  } catch { throw new Error('asset_unavailable'); }
}
module.exports = { saveArtifact, readArtifact };
