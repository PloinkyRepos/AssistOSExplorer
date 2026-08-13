const PRIVATE_PATH = '/api/edge/workspace-logs';

async function loadAssertionSigner() {
    const module = await import('/Agent/lib/agentAssertion.mjs');
    if (typeof module.signPrivateRouterAssertion !== 'function') throw new Error('Private Router assertion signer is unavailable.');
    return module.signPrivateRouterAssertion;
}

export async function callPloinkyLogs(input, {
    env = process.env,
    fetchImpl = fetch,
    signImpl,
    signal,
} = {}) {
    const routerUrl = String(env.PLOINKY_INTERNAL_ROUTER_URL || '').replace(/\/$/, '');
    if (!routerUrl) throw new Error('PLOINKY_INTERNAL_ROUTER_URL is required.');
    const body = Buffer.from(JSON.stringify(input || {}));
    const sign = signImpl || await loadAssertionSigner();
    const assertion = sign({ method: 'POST', path: PRIVATE_PATH, body, env });
    const response = await fetchImpl(`${routerUrl}${PRIVATE_PATH}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'ploinky-agent-assertion': assertion,
        },
        body,
        signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || `Ploinky log operation failed with HTTP ${response.status}.`);
    }
    return payload;
}

export function listPloinkyLogs(source, options) {
    return callPloinkyLogs({ action: 'list', source }, options);
}

export function getPloinkyLog(source, input = {}, options) {
    return callPloinkyLogs({ action: 'get', source, name: input.name, maxBytes: input.maxBytes }, options);
}

export function searchPloinkyLogs(source, input = {}, options) {
    return callPloinkyLogs({ action: 'search', source, query: input.query, limit: input.limit }, options);
}

export function maintainPloinkyLogs(retentionDays, options) {
    return callPloinkyLogs({ action: 'maintenance', retentionDays }, options);
}
