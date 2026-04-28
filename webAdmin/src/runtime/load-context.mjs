import {
    getDataStore,
} from './dataStore.mjs';
import { DATASTORE_TYPES } from '../constants/datastore.mjs';

async function listMarkdownFiles(store, type) {
    const listing = await store.listFiles(type);
    const files = await Promise.all(
        listing.files.map(async (fileName) => {
            const file = await store.getFile(type, fileName);
            return {
                fileName: `${fileName}.md`,
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

async function readOwnerInfo(store) {
    try {
        const owner = await store.getFile(DATASTORE_TYPES.CONFIG, 'owner');
        return {
            exists: true,
            fileName: 'owner.md',
            content: owner.rawMarkdown,
        };
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return {
                exists: false,
                fileName: 'owner.md',
                content: '',
            };
        }
        throw error;
    }
}

export async function loadContext() {
    const store = getDataStore();
    const profileListing = await store.listFiles(DATASTORE_TYPES.PROFILES_INFO);
    const siteInfoFiles = await listMarkdownFiles(store, DATASTORE_TYPES.INFO);
    const ownerInfo = await readOwnerInfo(store);
    const availableProfiles = profileListing.files
        .map((fileName) => `${fileName}.md`)
        .sort((left, right) => left.localeCompare(right));

    return {
        availableProfiles,
        ownerInfo,
        siteInfoFiles,
        combinedProfiles: availableProfiles.length > 0
            ? availableProfiles.join('\n')
            : 'No profiles available.',
        combinedOwnerInfo: ownerInfo.exists
            ? ownerInfo.content.trim()
            : 'No owner info available.',
        combinedSiteInfo: combineMarkdownFiles(siteInfoFiles, 'Info') || 'No site info available.',
    };
}
