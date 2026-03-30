import { createHash, createHmac } from 'node:crypto';
import { getAuthUserDisplayName, getAuthUserId } from './auth-info.mjs';
import { getOnlyOfficeFileType } from './file-types.mjs';

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/g, '');
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function resolveOnlyOfficeSettings(env = process.env, requestHeaders = {}) {
  const publicUrl = trimTrailingSlash(env.ONLYOFFICE_PUBLIC_URL);
  const internalUrl = trimTrailingSlash(env.ONLYOFFICE_INTERNAL_URL || publicUrl);
  const jwtSecret = String(env.ONLYOFFICE_JWT_SECRET || '').trim();
  const callbackBaseUrl = trimTrailingSlash(env.ONLYOFFICE_CALLBACK_BASE_URL);

  if (!publicUrl) {
    throw new Error('ONLYOFFICE_PUBLIC_URL is not configured.');
  }
  if (!jwtSecret) {
    throw new Error('ONLYOFFICE_JWT_SECRET is not configured.');
  }

  const forwardedProto = String(requestHeaders['x-forwarded-proto'] || '').trim();
  const protocol = forwardedProto || (requestHeaders[':scheme'] ? String(requestHeaders[':scheme']) : 'http');
  const host = String(requestHeaders['x-forwarded-host'] || requestHeaders.host || '').trim();
  const origin = callbackBaseUrl || (host ? `${protocol}://${host}` : '');
  if (!origin) {
    throw new Error('Could not resolve public base URL for OnlyOffice callback routes.');
  }

  return {
    publicUrl,
    internalUrl,
    jwtSecret,
    publicServiceBaseUrl: origin
  };
}

function buildDocumentKey(session) {
  const hash = createHash('sha256');
  hash.update([
    session.storageKind,
    session.storageId,
    session.versionKey,
    session.fileName
  ].join(':'));
  return hash.digest('hex').slice(0, 32);
}

export function buildOnlyOfficeEditorConfig({ session, settings, authInfo, documentUrl, callbackUrl }) {
  const fileType = getOnlyOfficeFileType(session.fileName);
  if (!fileType) {
    throw new Error(`Unsupported OnlyOffice file type for ${session.fileName}.`);
  }

  const canComment = Boolean(session.canComment);
  const canWrite = Boolean(session.canWrite);
  const baseConfig = {
    document: {
      title: session.fileName,
      fileType: fileType.extension,
      key: buildDocumentKey(session),
      url: documentUrl,
      permissions: {
        edit: canWrite,
        comment: canComment,
        review: canWrite || canComment
      }
    },
    documentType: fileType.documentType,
    editorConfig: {
      callbackUrl,
      mode: canWrite || canComment ? 'edit' : 'view',
      user: {
        id: getAuthUserId(authInfo) || 'explorer-user',
        name: getAuthUserDisplayName(authInfo)
      }
    }
  };

  return {
    ...baseConfig,
    token: signJwt(baseConfig, settings.jwtSecret),
    documentServerUrl: settings.publicUrl
  };
}

export function buildPublicOfficeUrl(settings, suffix) {
  const normalizedSuffix = String(suffix || '').replace(/^\/+/g, '');
  return `${settings.publicServiceBaseUrl}/public-services/explorer/office/${normalizedSuffix}`;
}

export function rewriteOnlyOfficeDownloadUrl(urlValue, settings) {
  const raw = String(urlValue || '').trim();
  if (!raw) {
    return raw;
  }
  if (!settings.internalUrl || settings.internalUrl === settings.publicUrl) {
    return raw;
  }
  if (!raw.startsWith(settings.publicUrl)) {
    return raw;
  }
  return `${settings.internalUrl}${raw.slice(settings.publicUrl.length)}`;
}

