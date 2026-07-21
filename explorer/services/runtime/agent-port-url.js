const AGENT_PORT_ROUTE = 'base-agent-additional-server';

export function buildAgentPortUrl(agent, port, suffix = '/') {
    const routeKey = String(agent || '').trim();
    const selectedPort = Number(port);
    if (!routeKey || !Number.isInteger(selectedPort) || selectedPort < 1 || selectedPort > 65535) {
        throw new Error('A valid agent route key and port are required.');
    }
    const normalizedSuffix = String(suffix || '/').startsWith('/')
        ? String(suffix || '/')
        : `/${String(suffix)}`;
    return `/${AGENT_PORT_ROUTE}/${encodeURIComponent(routeKey)}/${selectedPort}${normalizedSuffix}`;
}

export default buildAgentPortUrl;
