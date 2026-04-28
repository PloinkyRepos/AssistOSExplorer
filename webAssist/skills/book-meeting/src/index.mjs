import {
    getDataStore,
} from '../../../src/runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    getSessionLeadFileName,
} from '../../../src/constants/datastore.mjs';

const MISSING_LEAD_ERROR = 'the current session user does not have a lead! check if user is qualified for a lead then create it';

function combineMarkdownFiles(files, label) {
    return files
        .map(({ fileName, content }) => `--- [${label}: ${fileName}] ---\n${String(content ?? '').trim()}`)
        .join('\n\n');
}

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('bookMeeting expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('bookMeeting input must be an object.');
    }
    return parsed;
}

export async function action({ promptText }) {
    const { sessionId } = parseInput(promptText);

    if (!sessionId) {
        throw new Error('bookMeeting requires a sessionId.');
    }

    const store = getDataStore();
    const leadFileName = getSessionLeadFileName(sessionId);
    try {
        await store.getSectionMap(DATASTORE_TYPES.LEADS, leadFileName);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            throw new Error(MISSING_LEAD_ERROR);
        }
        throw error;
    }

    const listing = await store.listFiles(DATASTORE_TYPES.CONFIG);
    const configFiles = await Promise.all(
        listing.files.map(async (itemName) => {
            const file = await store.getFile(DATASTORE_TYPES.CONFIG, itemName);
            return { fileName: `${itemName}.md`, content: file.rawMarkdown };
        })
    );
    if (configFiles.length === 0) {
        throw new Error('No configuration found to book a meeting.');
    }

    return combineMarkdownFiles(configFiles, 'Config');
}
