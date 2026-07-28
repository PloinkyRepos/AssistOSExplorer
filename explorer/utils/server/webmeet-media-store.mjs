import crypto from 'node:crypto';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const BLOB_ID_RE = /^[a-f0-9]{48}$/;
const SAFE_ID_RE = /^[a-zA-Z0-9_.:-]+$/;

function jpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    if (!Number.isFinite(length) || length < 2) break;
    offset += length + 2;
  }
  throw new Error('JPEG dimensions could not be read.');
}

function webpSize(buffer) {
  const kind = buffer.toString('ascii', 12, 16);
  if (kind === 'VP8X' && buffer.length >= 30) {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (kind === 'VP8 ' && buffer.length >= 30) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  throw new Error('WebP dimensions could not be read.');
}

export function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('The uploaded image is empty.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Images may not exceed 15 MB.');
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: 'image/png', extension: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return { mimeType: 'image/gif', extension: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { mimeType: 'image/jpeg', extension: 'jpg', ...jpegSize(buffer) };
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp', ...webpSize(buffer) };
  }
  throw new Error('Only PNG, JPEG, WebP, and GIF images are supported.');
}

function safeId(value, label) {
  const id = String(value || '').trim();
  if (!id || !SAFE_ID_RE.test(id) || id.includes('..')) throw new Error(`Invalid ${label}.`);
  return id;
}

function validateBlobRef(blobRef, expectedAgent) {
  const id = String(blobRef?.id || '').trim();
  const agent = String(blobRef?.agent || '').trim();
  const localPath = String(blobRef?.localPath || '').trim();
  if (!BLOB_ID_RE.test(id)) throw new Error('Invalid Explorer blob id.');
  if (agent !== expectedAgent) throw new Error('The staged blob belongs to a different agent.');
  if (localPath !== `blobs/${id}`) throw new Error('The staged blob path does not match its id.');
  return { id, localPath };
}

export function createWebMeetMediaStore({
  fs,
  path,
  validatePath,
  agentName = process.env.PLOINKY_AGENT_NAME || process.env.AGENT_NAME || 'explorer'
}) {

  async function metadataPath(roomId, assetId) {
    return validatePath(`/document-multimedia/webmeet/${safeId(roomId, 'roomId')}/assets/${safeId(assetId, 'assetId')}.json`);
  }

  async function read(roomId, assetId) {
    const raw = await fs.readFile(await metadataPath(roomId, assetId), 'utf8');
    const asset = JSON.parse(raw);
    if (asset.roomId !== roomId || asset.assetId !== assetId) throw new Error('Media asset metadata is invalid.');
    return asset;
  }

  async function commit({ roomId, blobRef, filename = '', createdBy = '' }) {
    const cleanRoomId = safeId(roomId, 'roomId');
    const staged = validateBlobRef(blobRef, String(agentName || 'explorer'));
    const blobPath = await validatePath(staged.localPath);
    const blobMetaPath = await validatePath(`${staged.localPath}.json`);
    const stat = await fs.lstat(blobPath);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('Images may not exceed 15 MB.');
    const image = inspectImage(await fs.readFile(blobPath));
    const assetId = `asset_${crypto.randomUUID()}`;
    const relativePath = `document-multimedia/webmeet/${cleanRoomId}/assets/${assetId}.${image.extension}`;
    const targetPath = await validatePath(`/${relativePath}`);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await fs.rename(blobPath, targetPath);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      await fs.copyFile(blobPath, targetPath);
      await fs.unlink(blobPath);
    }
    await fs.unlink(blobMetaPath).catch(() => {});
    const asset = {
      assetId, roomId: cleanRoomId, kind: 'image',
      filename: path.basename(String(filename || 'image').replace(/\0/g, '')) || 'image',
      mimeType: image.mimeType, extension: image.extension, size: stat.size,
      width: image.width, height: image.height,
      workspaceUrl: `/${relativePath}`,
      createdAt: new Date().toISOString(), createdBy: String(createdBy || '').trim()
    };
    await fs.writeFile(await metadataPath(cleanRoomId, assetId), JSON.stringify(asset, null, 2), 'utf8');
    return asset;
  }

  return { commit, read };
}
