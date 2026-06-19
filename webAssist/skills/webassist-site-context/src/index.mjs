import { loadAkuContext } from '../../../src/runtime/load-aku-context.mjs';

function parseInput(promptText) {
    try {
        const parsed = JSON.parse(String(promptText ?? '{}'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        throw new Error('webassist-site-context expects promptText to be valid JSON.');
    }
}

export async function action({ promptText, context }) {
    const { siteId, sessionId, message } = parseInput(promptText);
    if (!siteId || !sessionId) {
        throw new Error('webassist-site-context requires siteId and sessionId.');
    }

    const siteDataDir = context?.siteDataDir || '';
    if (!siteDataDir) {
        throw new Error('webassist-site-context requires context.siteDataDir.');
    }

    const akuContext = await loadAkuContext({
        siteDataDir,
        siteId,
        sessionId,
        message: message || '',
    });

    return akuContext.akuContextText || 'No relevant site context found.';
}
