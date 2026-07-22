const EDGE_RUNTIME_DIR = process.env.PLOINKY_AGENT_LIB_DIR || '/Agent';
const ONLYOFFICE_ROUTE_KEY = 'onlyOffice';
const ONLYOFFICE_EDITOR_SLUG = 'onlyoffice-editor';

let runtimePromise = null;

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import(`${EDGE_RUNTIME_DIR}/lib/edgeTopology.mjs`);
  }
  return runtimePromise;
}

export async function resolveOnlyOfficeEditorService({
  file = process.env.PLOINKY_EDGE_TOPOLOGY_FILE,
  resolveEdgeService,
} = {}) {
  const resolver = resolveEdgeService || (await loadRuntime()).resolveEdgeService;
  const service = await resolver({
    routeKey: ONLYOFFICE_ROUTE_KEY,
    slug: ONLYOFFICE_EDITOR_SLUG,
    requireActive: true,
    file,
  });
  const activeBrowserUrl = String(service?.activeBrowserUrl || '').trim();
  if (!activeBrowserUrl) {
    throw new Error('OnlyOffice editor topology is not active.');
  }
  const browserUrl = new URL(activeBrowserUrl);
  if (!['http:', 'https:'].includes(browserUrl.protocol)) {
    throw new Error('OnlyOffice editor topology requires an HTTP(S) browser URL.');
  }
  browserUrl.pathname = browserUrl.pathname.replace(/\/+$/, '') || '/';
  browserUrl.search = '';
  browserUrl.hash = '';
  return {
    ...service,
    activeBrowserUrl: browserUrl.toString().replace(/\/$/, ''),
    browserOrigin: browserUrl.origin,
    routeKey: ONLYOFFICE_ROUTE_KEY,
    slug: ONLYOFFICE_EDITOR_SLUG,
  };
}

export const _test = Object.freeze({
  ONLYOFFICE_ROUTE_KEY,
  ONLYOFFICE_EDITOR_SLUG,
});
