import crypto from 'node:crypto';

function asDate(value) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
}

function toIso(value) {
  return asDate(value).toISOString();
}

function minDate(left, right) {
  return left.getTime() <= right.getTime() ? left : right;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('base64url');
}

function cloneRoles(input) {
  return Array.isArray(input) ? input.map((role) => String(role || '').trim()).filter(Boolean) : [];
}

function cloneAuthUser(user = {}) {
  return {
    id: String(user.id || '').trim(),
    username: String(user.username || '').trim(),
    roles: cloneRoles(user.roles),
  };
}

function cloneDelegations(delegations = {}) {
  const out = {};
  if (!delegations || typeof delegations !== 'object') {
    return out;
  }
  for (const [key, value] of Object.entries(delegations)) {
    if (!value || typeof value !== 'object') continue;
    const token = String(value.token || '').trim();
    const expiresAt = value.expiresAt ? toIso(value.expiresAt) : '';
    if (!token || !expiresAt) continue;
    out[key] = { token, expiresAt };
  }
  return out;
}

function earliestDelegationExpiry(delegations, fallbackDate) {
  const values = Object.values(cloneDelegations(delegations));
  if (!values.length) {
    return asDate(fallbackDate);
  }
  return values.reduce((best, entry) => minDate(best, asDate(entry.expiresAt)), asDate(fallbackDate));
}

function sanitizeStoredSession(record) {
  return {
    tokenHash: record.tokenHash,
    requestedPath: record.requestedPath,
    path: record.path,
    storageKind: record.storageKind,
    storageId: record.storageId,
    objectId: record.objectId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    canWrite: Boolean(record.canWrite),
    canComment: Boolean(record.canComment),
    versionKey: record.versionKey,
    preview: clonePreview(record.preview),
    authUser: cloneAuthUser(record.authUser),
    delegations: cloneDelegations(record.delegations),
    createdAt: record.createdAt,
    idleExpiresAt: record.idleExpiresAt,
    absoluteExpiresAt: record.absoluteExpiresAt,
  };
}

function publicSummaryFromRecord(record, token = '') {
  return {
    ...(token ? { token } : {}),
    requestedPath: record.requestedPath,
    path: record.path,
    storageKind: record.storageKind,
    storageId: record.storageId,
    objectId: record.objectId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    canWrite: Boolean(record.canWrite),
    canComment: Boolean(record.canComment),
    versionKey: record.versionKey,
    preview: clonePreview(record.preview),
    authUser: cloneAuthUser(record.authUser),
    createdAt: record.createdAt,
    idleExpiresAt: record.idleExpiresAt,
    absoluteExpiresAt: record.absoluteExpiresAt,
    publicSummary() {
      return {
        requestedPath: record.requestedPath,
        path: record.path,
        storageKind: record.storageKind,
        storageId: record.storageId,
        objectId: record.objectId,
        fileName: record.fileName,
        mimeType: record.mimeType,
        canWrite: Boolean(record.canWrite),
        canComment: Boolean(record.canComment),
        versionKey: record.versionKey,
        preview: clonePreview(record.preview),
        authUser: cloneAuthUser(record.authUser),
        createdAt: record.createdAt,
        idleExpiresAt: record.idleExpiresAt,
        absoluteExpiresAt: record.absoluteExpiresAt,
      };
    },
  };
}

function clonePreview(preview = null) {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    return null;
  }
  return {
    storageKind: String(preview.storageKind || '').trim(),
    requestedPath: String(preview.requestedPath || '').trim(),
    ...(preview.objectId ? { objectId: String(preview.objectId).trim() } : {}),
    canWrite: Boolean(preview.canWrite),
    canComment: Boolean(preview.canComment),
  };
}

export function createSessionStore({ now = () => new Date(), idleTtlMs = 30 * 60 * 1000, absoluteTtlMs = 8 * 60 * 60 * 1000 } = {}) {
  const sessions = new Map();

  function resolveNow(value) {
    return asDate(value || now());
  }

  function readRecordByToken(token) {
    return sessions.get(hashToken(token)) || null;
  }

  function assertActive(record, valueNow) {
    const at = resolveNow(valueNow);
    if (!record) {
      throw new Error('Unknown or expired OnlyOffice session token.');
    }
    if (at.getTime() >= asDate(record.absoluteExpiresAt).getTime()) {
      sessions.delete(record.tokenHash);
      throw new Error('Unknown or expired OnlyOffice session token.');
    }
    if (at.getTime() >= asDate(record.idleExpiresAt).getTime()) {
      sessions.delete(record.tokenHash);
      throw new Error('Unknown or expired OnlyOffice session token.');
    }
    return at;
  }

  return {
    createSession(input = {}) {
      const createdAt = resolveNow(input.createdAt);
      const idleCandidate = new Date(createdAt.getTime() + idleTtlMs);
      const absoluteCandidate = new Date(createdAt.getTime() + absoluteTtlMs);
      const absoluteExpiresAt = earliestDelegationExpiry(input.delegations, absoluteCandidate);
      const idleExpiresAt = minDate(idleCandidate, absoluteExpiresAt);
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      const record = {
        tokenHash,
        requestedPath: String(input.requestedPath || input.path || '').trim(),
        path: String(input.path || '').trim(),
        storageKind: String(input.storageKind || '').trim(),
        storageId: String(input.storageId || '').trim(),
        objectId: String(input.objectId || '').trim(),
        fileName: String(input.fileName || '').trim(),
        mimeType: String(input.mimeType || '').trim(),
        canWrite: Boolean(input.canWrite),
        canComment: Boolean(input.canComment),
        versionKey: String(input.versionKey || '').trim(),
        preview: clonePreview(input.preview),
        authUser: cloneAuthUser(input.authUser),
        delegations: cloneDelegations(input.delegations),
        createdAt: createdAt.toISOString(),
        idleExpiresAt: idleExpiresAt.toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      };
      sessions.set(tokenHash, record);
      return publicSummaryFromRecord(record, token);
    },

    touchSession(token, { now: valueNow } = {}) {
      const record = readRecordByToken(token);
      const touchedAt = assertActive(record, valueNow);
      const nextIdleExpiry = minDate(
        new Date(touchedAt.getTime() + idleTtlMs),
        asDate(record.absoluteExpiresAt)
      );
      record.idleExpiresAt = nextIdleExpiry.toISOString();
      sessions.set(record.tokenHash, record);
      return publicSummaryFromRecord(record);
    },

    getForStorageRequest(token, { now: valueNow } = {}) {
      const record = readRecordByToken(token);
      const at = assertActive(record, valueNow);
      const nextIdleExpiry = minDate(
        new Date(at.getTime() + idleTtlMs),
        asDate(record.absoluteExpiresAt)
      );
      record.idleExpiresAt = nextIdleExpiry.toISOString();
      sessions.set(record.tokenHash, record);
      return sanitizeStoredSession(record);
    },
  };
}

export default { createSessionStore };
