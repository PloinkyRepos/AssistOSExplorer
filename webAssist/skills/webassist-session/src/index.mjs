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
        profiles,
        profileDetails,
        contactInformation,
        consent,
    } = parsePayload(promptText);

    if (!siteId || !sessionId) {
        throw new Error('webassist-session requires siteId and sessionId.');
    }

    const saved = await updateSessionProfile({
        siteId,
        sessionId,
        profiles: Array.isArray(profiles) ? profiles : [],
        profileDetails: Array.isArray(profileDetails) ? profileDetails : [],
        contactInformation: contactInformation || {},
        consent,
    });

    return [
        `Updated session ${saved.sessionPath}.`,
        `Site ID: ${siteId}`,
        `Session ID: ${sessionId}`,
        `Profiles: ${Array.isArray(profiles) ? profiles.length : 0}`,
        `Profile Details: ${Array.isArray(profileDetails) ? profileDetails.length : 0}`,
    ].join('\n');
}
