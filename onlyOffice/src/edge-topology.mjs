const ONLYOFFICE_EDITOR_PATH = '/base-agent-additional-server/onlyOffice/8080/';

function firstHeader(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export async function resolveOnlyOfficeEditorService({
  req,
  env = process.env,
} = {}) {
  const protocol = firstHeader(req?.headers?.['x-forwarded-proto']).trim().toLowerCase()
    || new URL(String(env.PLOINKY_ROUTER_URL || 'http://127.0.0.1:8080')).protocol.replace(':', '');
  const authority = firstHeader(req?.headers?.['x-forwarded-host']).trim()
    || new URL(String(env.PLOINKY_ROUTER_URL || 'http://127.0.0.1:8080')).host;
  if (!['http', 'https'].includes(protocol) || !authority || /[/\\\s]/.test(authority)) {
    throw new Error('OnlyOffice editor Router origin is invalid.');
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
