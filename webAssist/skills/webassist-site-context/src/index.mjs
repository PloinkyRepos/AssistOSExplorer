import { loadContext } from '../../../src/runtime/load-context.mjs';

function parseInput(promptText) {
    try {
        const parsed = JSON.parse(String(promptText ?? '{}'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        throw new Error('webassist-site-context expects promptText to be valid JSON.');
    }
}

export async function action({ promptText }) {
    const { siteId, sessionId } = parseInput(promptText);
    if (!siteId || !sessionId) {
        throw new Error('webassist-site-context requires siteId and sessionId.');
    }

    const context = await loadContext({ siteId, sessionId });
    return [
        `Site ID: ${siteId}`,
        'Visitor Policy:',
        context.policyText,
        'Owner Contact Rules:',
        context.ownerConfigText,
        'Website Info:',
        context.combinedSiteInfo,
        'Target Profiles:',
        context.combinedProfiles,
    ].join('\n');
}
