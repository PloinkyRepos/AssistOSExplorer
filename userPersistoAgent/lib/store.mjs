import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { ensureSchema } from './schema.mjs';
import { resetSerialForTests } from './serial.mjs';

const require = createRequire(import.meta.url);

let storePromise = null;

function ensurePersistoGlobals() {
    if (!globalThis.$$) {
        globalThis.$$ = {};
    }
    if (typeof globalThis.$$.throwError !== 'function') {
        globalThis.$$.throwError = async (...parts) => {
            const error = parts.find((part) => part instanceof Error);
            if (error) {
                throw error;
            }
            throw new Error(parts.map(String).join(' '));
        };
    }
}

async function initialise() {
    const folder = process.env.PERSISTENCE_FOLDER;
    if (!folder) {
        throw new Error('PERSISTENCE_FOLDER is required; UserPersisto refuses to start without durable Persisto storage.');
    }
    mkdirSync(folder, { recursive: true });
    ensurePersistoGlobals();
    const { getAutoSaverPersistence } = require('../vendor/Persisto/src/persistence/ObjectsAutoSaver.cjs');
    const { initialisePersisto } = require('../vendor/Persisto/src/persistence/Persisto.cjs');
    const storage = await getAutoSaverPersistence();
    const persisto = await initialisePersisto(storage, { smartLog: async () => {} });
    await ensureSchema(persisto);
    return persisto;
}

export function getStore() {
    if (!storePromise) {
        storePromise = initialise();
    }
    return storePromise;
}

export async function flush() {
    const store = await getStore();
    await store.forceSave();
}

export async function resetStoreForTests() {
    if (storePromise) {
        const store = await storePromise;
        await store.shutDown();
    }
    storePromise = null;
    resetSerialForTests();
}
