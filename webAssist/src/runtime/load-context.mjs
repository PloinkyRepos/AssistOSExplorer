import {
    getDataStore,
} from './dataStore.mjs';
import {
    DATASTORE_TYPES,
    LEAD_SECTIONS,
    SESSION_SECTIONS,
    getSessionProfileFileName,
    getSessionHistoryFileName,
    getSessionLeadFileName,
} from '../constants/datastore.mjs';

async function listMarkdownFiles(store, type) {
    const listing = await store.listFiles(type);
    const files = await Promise.all(
        listing.files.map(async (itemName) => {
            const file = await store.getFile(type, itemName);
            return {
                fileName: `${itemName}.md`,
                content: file.rawMarkdown,
            };
        })
    );
    return files;
}

function combineMarkdownFiles(files, label) {
    if (!Array.isArray(files) || files.length === 0) {
        return '';
    }
    return files
        .map(({ fileName, content }) => `--- [${label}: ${fileName}] ---\n${String(content ?? '').trim()}`)
        .join('\n\n');
}

function formatConversationHistory(dialogueEntries, maxEntries = 10) {
    if (!Array.isArray(dialogueEntries) || dialogueEntries.length === 0) {
        return 'No previous conversation history found.';
    }

    const normalizedEntries = dialogueEntries
        .map((entry) => {
            const speaker = String(entry?.speaker ?? entry?.role ?? '').trim();
            const message = String(entry?.message ?? '').trim();
            if (!message) {
                return null;
            }
            return {
                speaker: speaker || 'Unknown',
                message,
            };
        })
        .filter(Boolean);

    if (normalizedEntries.length === 0) {
        return 'No previous conversation history found.';
    }

    const recentEntries = normalizedEntries.slice(-Math.max(1, maxEntries));
    return recentEntries
        .map(({ speaker, message }) => `- **${speaker}**: ${message}`)
        .join('\n');
}

async function readConfigFile(store, fileName) {
    try {
        const file = await store.getFile(DATASTORE_TYPES.CONFIG, fileName);
        return {
            exists: true,
            fileName: `${fileName}.md`,
            content: file.rawMarkdown,
        };
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return {
                exists: false,
                fileName: `${fileName}.md`,
                content: '',
            };
        }
        throw error;
    }
}

export async function loadContext({ siteId, sessionId }) {
    if (!siteId) {
        throw new Error('load-context requires a siteId.');
    }
    if (!sessionId) {
        throw new Error('load-context requires a sessionId.');
    }

    const store = getDataStore();
    const siteInfo = await listMarkdownFiles(store, DATASTORE_TYPES.INFO);
    const profiles = await listMarkdownFiles(store, DATASTORE_TYPES.PROFILES);
    const sessionProfileFileName = getSessionProfileFileName(sessionId);
    const sessionHistoryFileName = getSessionHistoryFileName(sessionId);
    const sessionLeadFileName = getSessionLeadFileName(sessionId);
    const ownerConfig = await readConfigFile(store, 'owner');
    const policyConfig = await readConfigFile(store, 'policy');
    let currentLead = null;
    let conversationHistoryText = 'No previous conversation history found.';
    const emptyProfile = {
        profileDetails: [],
        contactInformation: {},
    };

    const readSectionMap = async (type, fileName) => {
        try {
            return await store.getSectionMap(type, fileName);
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    };

    const profileRecord = await readSectionMap(DATASTORE_TYPES.SESSIONS, sessionProfileFileName);
    const historyRecord = await readSectionMap(DATASTORE_TYPES.SESSIONS, sessionHistoryFileName);
    const leadRecord = await readSectionMap(DATASTORE_TYPES.LEADS, sessionLeadFileName);
    const profileExists = Boolean(profileRecord);

    let sessionProfileText;
    let sessionProfileParsed;
    if (!profileExists) {
        sessionProfileParsed = emptyProfile;
        sessionProfileText = 'No previous session record found. This is a new session.';
    } else {
        const combined = `--- [Session: ${sessionProfileFileName}.md] ---\n${profileRecord.rawMarkdown.trim()}`;
        sessionProfileParsed = {
            profileDetails: store.parseList(profileRecord?.sections?.[SESSION_SECTIONS.PROFILE_DETAILS]),
            contactInformation: store.parseKeyValue(profileRecord?.sections?.[SESSION_SECTIONS.CONTACT_INFORMATION]),
        };
        sessionProfileText = combined.trim();
    }

    if (historyRecord?.sections?.[SESSION_SECTIONS.HISTORY]) {
        const parsedHistory = store.parseDialogue(historyRecord.sections[SESSION_SECTIONS.HISTORY]);
        conversationHistoryText = formatConversationHistory(parsedHistory, 10);
    }

    if (!leadRecord) {
        currentLead = {
            exists: false,
        };
    } else {
        const leadInfo = store.parseKeyValue(leadRecord.sections?.[LEAD_SECTIONS.LEAD_INFO]);
        const contactInfo = store.parseKeyValue(leadRecord.sections?.[LEAD_SECTIONS.CONTACT_INFO]);
        currentLead = {
            exists: true,
            leadId: `${sessionLeadFileName}.md`,
            status: String(leadInfo?.Status ?? '').trim(),
            profile: String(leadInfo?.Profile ?? '').trim(),
            sessionId: String(leadInfo?.['Session ID'] ?? '').trim(),
            contactInfo,
            matchExplanation: String(leadRecord.sections?.[LEAD_SECTIONS.MATCH_EXPLANATION] ?? '').trim(),
            summary: String(leadRecord.sections?.[LEAD_SECTIONS.SUMMARY] ?? '').trim(),
        };
    }

    return {
        siteId,
        siteInfo,
        profiles,
        ownerConfig,
        policyConfig,
        currentLead,
        sessionProfile: {
            siteId,
            sessionId,
            isNewSession: !profileExists,
            ...sessionProfileParsed,
        },
        combinedSiteInfo: combineMarkdownFiles(siteInfo, 'Info') || 'No site info available.',
        combinedProfiles: combineMarkdownFiles(profiles, 'Profile') || 'No target profiles available.',
        ownerConfigText: ownerConfig.exists ? ownerConfig.content.trim() : 'No owner contact rules available.',
        policyText: policyConfig.exists ? policyConfig.content.trim() : 'No visitor policy available.',
        conversationHistoryText,
        sessionProfileText,
    };
}
