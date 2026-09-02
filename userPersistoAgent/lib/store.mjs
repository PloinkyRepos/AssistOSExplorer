import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { ensureSchema } from './schema.mjs';
import { resetSerialForTests } from './serial.mjs';
import { createDurableStorage } from './durable-storage.mjs';
import { withPersistenceScope } from './persistence-scope.mjs';

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
    const { initialisePersisto } = require('../vendor/Persisto/src/persistence/Persisto.cjs');
    const durable = await createDurableStorage(folder);
    try {
        const persisto = await initialisePersisto(durable.storage, { smartLog: async () => {} });
        await ensureSchema(persisto);
        // A flush must exclude CRUD while Persisto gathers and clears dirty
        // objects. Domain-level serialization remains responsible for workflows.
        let tail = Promise.resolve();
        return new Proxy(persisto, {
            get(target, name) {
                if (typeof target[name] !== 'function') return target[name];
                return (...args) => withPersistenceScope(() => {
                    const operation = tail.then(() => {
                        if (name !== 'shutDown') durable.check();
                        return target[name](...args);
                    });
                    tail = operation.catch(() => {});
                    return operation;
                });
            },
        });
    } catch (error) {
        durable.abandon();
        throw error;
    }
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
    try {
        if (storePromise) {
            const store = await storePromise;
            await store.shutDown();
        }
    } finally {
        storePromise = null;
        resetSerialForTests();
    }
}
