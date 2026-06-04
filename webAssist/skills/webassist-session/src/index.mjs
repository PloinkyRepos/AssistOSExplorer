import { updateSessionProfile } from '../../../src/runtime/update-session.mjs';

function parsePayload(promptText) {
    let payload;
    try {
        payload = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('webassist-session expects promptText to be valid JSON.');
    }

    if (!payload || typeof payload !== 'object') {
        throw new Error('webassist-session input must be an object.');
    }

    return payload;
}

export async function action({ promptText }) {
    const {
        siteId,
        sessionId,
        profileDetails,
        contactInformation,
    } = parsePayload(promptText);

    if (!siteId || !sessionId) {
        throw new Error('webassist-session requires siteId and sessionId.');
    }

    const saved = await updateSessionProfile({
        siteId,
        sessionId,
        profileDetails: Array.isArray(profileDetails) ? profileDetails : [],
        contactInformation: contactInformation || {},
    });

    return 'Operation successful.';
}
