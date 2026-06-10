import { createHash, createHmac } from 'node:crypto';

const FILE_TYPES = Object.freeze({
  csv: Object.freeze({ extension: 'csv', documentType: 'cell' }),
  doc: Object.freeze({ extension: 'doc', documentType: 'word' }),
  docx: Object.freeze({ extension: 'docx', documentType: 'word' }),
  odp: Object.freeze({ extension: 'odp', documentType: 'slide' }),
  ods: Object.freeze({ extension: 'ods', documentType: 'cell' }),
  odt: Object.freeze({ extension: 'odt', documentType: 'word' }),
  pdf: Object.freeze({ extension: 'pdf', documentType: 'pdf' }),
  ppt: Object.freeze({ extension: 'ppt', documentType: 'slide' }),
  pptx: Object.freeze({ extension: 'pptx', documentType: 'slide' }),
  xls: Object.freeze({ extension: 'xls', documentType: 'cell' }),
  xlsx: Object.freeze({ extension: 'xlsx', documentType: 'cell' }),
});

function fileTypeFor(name) {
  const match = String(name || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match ? FILE_TYPES[match[1]] || null : null;
}

function signJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function buildDocumentKey(session) {
  return createHash('sha256')
    .update([
      session.storageKind,
      session.storageId,
      session.versionKey,
      session.fileName,
    ].join(':'))
    .digest('hex')
    .slice(0, 32);
}

export function buildSignedOnlyOfficeConfig({
  session,
  config,
  authUser,
  documentUrl,
  callbackUrl,
} = {}) {
  const fileType = fileTypeFor(session?.fileName);
  if (!fileType) {
    throw new Error(`Unsupported OnlyOffice file type for ${session?.fileName || '<unknown>'}.`);
  }

  const baseConfig = {
    document: {
      title: session.fileName,
      fileType: fileType.extension,
      key: buildDocumentKey(session),
      url: documentUrl,
      permissions: {
        edit: Boolean(session.canWrite),
        comment: Boolean(session.canComment),
        review: Boolean(session.canWrite || session.canComment),
      },
    },
    documentType: fileType.documentType,
    editorConfig: {
      callbackUrl,
      mode: session.canWrite || session.canComment ? 'edit' : 'view',
      user: {
        id: String(authUser?.id || 'onlyoffice-user'),
        name: String(authUser?.username || authUser?.id || 'OnlyOffice User'),
      },
    },
  };

  return {
    ...baseConfig,
    token: signJwt(baseConfig, config.onlyofficeJwtSecret),
    documentServerUrl: config.publicEditorBaseUrl,
  };
}

export default {
  buildSignedOnlyOfficeConfig,
};
