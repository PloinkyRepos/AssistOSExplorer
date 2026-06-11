import { loadAkuContext } from '../../../src/runtime/load-aku-context.mjs';

function parseInput(promptText) {
    try {
        const parsed = JSON.parse(String(promptText ?? '{}'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        throw new Error('webassist-site-context expects promptText to be valid JSON.');
    }
}

function getDefaultAgentRoot() {
    return process.env.WORKSPACE_PATH || process.cwd();
}

export async function action({ promptText, context }) {
    const { siteId, sessionId, message } = parseInput(promptText);
    if (!siteId || !sessionId) {
        throw new Error('webassist-site-context requires siteId and sessionId.');
    }

    const agentRoot = context?.agentRoot || getDefaultAgentRoot();
    const dataDir = context?.dataDir || null;

    const akuContext = await loadAkuContext({
        agentRoot,
        dataDir,
        siteId,
        sessionId,
        message: message || '',
    });

    return akuContext.akuContextText || 'No relevant site context found.';
}
