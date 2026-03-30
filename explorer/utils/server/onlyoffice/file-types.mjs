const OFFICE_FILE_TYPES = Object.freeze({
  csv: Object.freeze({
    extension: 'csv',
    documentType: 'cell',
    mimeType: 'text/csv'
  }),
  doc: Object.freeze({
    extension: 'doc',
    documentType: 'word',
    mimeType: 'application/msword'
  }),
  docx: Object.freeze({
    extension: 'docx',
    documentType: 'word',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }),
  odp: Object.freeze({
    extension: 'odp',
    documentType: 'slide',
    mimeType: 'application/vnd.oasis.opendocument.presentation'
  }),
  ods: Object.freeze({
    extension: 'ods',
    documentType: 'cell',
    mimeType: 'application/vnd.oasis.opendocument.spreadsheet'
  }),
  odt: Object.freeze({
    extension: 'odt',
    documentType: 'word',
    mimeType: 'application/vnd.oasis.opendocument.text'
  }),
  pdf: Object.freeze({
    extension: 'pdf',
    documentType: 'pdf',
    mimeType: 'application/pdf'
  }),
  ppt: Object.freeze({
    extension: 'ppt',
    documentType: 'slide',
    mimeType: 'application/vnd.ms-powerpoint'
  }),
  xlsx: Object.freeze({
    extension: 'xlsx',
    documentType: 'cell',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }),
  xls: Object.freeze({
    extension: 'xls',
    documentType: 'cell',
    mimeType: 'application/vnd.ms-excel'
  }),
  pptx: Object.freeze({
    extension: 'pptx',
    documentType: 'slide',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  })
});

function getExtension(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const match = normalized.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

export function getOnlyOfficeFileType(value) {
  const extension = getExtension(value);
  return OFFICE_FILE_TYPES[extension] || null;
}

export function isOnlyOfficeFile(value) {
  return Boolean(getOnlyOfficeFileType(value));
}

export function getOnlyOfficeMimeType(value, fallback = '') {
  return getOnlyOfficeFileType(value)?.mimeType || String(fallback || '');
}
