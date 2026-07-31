const ONLYOFFICE_EDITOR_PATH = '/base-agent-additional-server/onlyOffice/8080/';

function firstHeader(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export async function resolveOnlyOfficeEditorService({
  req,
} = {}) {
  const protocol = firstHeader(req?.headers?.['x-forwarded-proto']).trim().toLowerCase();
  const authority = firstHeader(req?.headers?.['x-forwarded-host']).trim();
  if (!['http', 'https'].includes(protocol) || !authority || /[/\\\s]/.test(authority)) {
    throw new Error('OnlyOffice editor requires the Router-authenticated forwarded browser origin.');
  }
  const browserUrl = new URL(ONLYOFFICE_EDITOR_PATH, `${protocol}://${authority}`);
  return {
    activeBrowserUrl: browserUrl.toString().replace(/\/$/, ''),
    browserOrigin: browserUrl.origin,
    routeKey: 'onlyOffice',
  };
}

export const _test = Object.freeze({
  ONLYOFFICE_EDITOR_PATH,
});
