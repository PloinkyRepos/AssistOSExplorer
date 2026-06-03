function parseInput(promptText) {
    try {
        const parsed = JSON.parse(String(promptText ?? '{}'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        throw new Error('webassist-match expects promptText to be valid JSON.');
    }
}

export async function action({ promptText }) {
    const {
        siteId,
        sessionId,
        profile,
        mandatoryConditionsSatisfied,
        matchExplanation,
    } = parseInput(promptText);

    if (!siteId || !sessionId || !profile) {
        throw new Error('webassist-match requires siteId, sessionId, and profile.');
    }
    if (mandatoryConditionsSatisfied !== true) {
        throw new Error('webassist-match requires satisfied mandatory profile conditions.');
    }
    if (!String(matchExplanation ?? '').trim()) {
        throw new Error('webassist-match requires a match explanation.');
    }

    return [
        'Profile match validated.',
        `Site ID: ${siteId}`,
        `Session ID: ${sessionId}`,
        `Profile: ${String(profile).trim()}`,
        `Match Explanation: ${String(matchExplanation).trim()}`,
    ].join('\n');
}
