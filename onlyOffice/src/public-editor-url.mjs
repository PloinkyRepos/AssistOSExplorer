export const ONLYOFFICE_EDITOR_ROUTE_PREFIX = '/base-agent-additional-server/onlyOffice/8080';

export function resolveCanonicalEditorBrowserUrl(publicBrowserUrl) {
  if (typeof publicBrowserUrl !== 'string' || publicBrowserUrl !== publicBrowserUrl.trim()) {
    throw new Error('OnlyOffice editor browser URL is invalid.');
  }
  let browserUrl;
  try {
    browserUrl = new URL(publicBrowserUrl);
  } catch (_) {
    throw new Error('OnlyOffice editor browser URL is invalid.');
  }
  if (
    !['http:', 'https:'].includes(browserUrl.protocol)
    || browserUrl.username
    || browserUrl.password
    || browserUrl.search
    || browserUrl.hash
    || browserUrl.pathname !== ONLYOFFICE_EDITOR_ROUTE_PREFIX
    || publicBrowserUrl !== `${browserUrl.origin}${ONLYOFFICE_EDITOR_ROUTE_PREFIX}`
  ) {
    throw new Error('OnlyOffice editor browser URL does not match the committed Router route.');
  }
  return {
    browserUrl,
    prefix: ONLYOFFICE_EDITOR_ROUTE_PREFIX,
  };
}
