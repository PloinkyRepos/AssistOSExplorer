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

export async function action({ promptText, context }) {
    const {
        siteId,
        sessionId,
        profileDetails,
        contactInformation,
    } = parsePayload(promptText);

    if (!siteId || !sessionId) {
        throw new Error('webassist-session requires siteId and sessionId.');
    }

    const siteDataDir = context?.siteDataDir || '';
    if (!siteDataDir) {
        throw new Error('webassist-session requires context.siteDataDir.');
    }

    const saved = await updateSessionProfile({
        siteDataDir,
        siteId,
        sessionId,
        profileDetails: Array.isArray(profileDetails) ? profileDetails : [],
        contactInformation: contactInformation || {},
    });

    const detailCount = Array.isArray(profileDetails) ? profileDetails.length : 0;
    const contactKeys = contactInformation ? Object.keys(contactInformation).length : 0;
    return `[internal] Session profile persisted: ${detailCount} detail(s), ${contactKeys} contact field(s). Compose visitor-facing response.`;
}
