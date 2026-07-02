import { getStore } from './lib/store.mjs';
import { ensureSeedData, ensureDevAdmin } from './lib/bootstrap.mjs';
import { startService } from './service/index.mjs';

const SERVICE_PORT = Number.parseInt(String(process.env.USERPERSISTO_SERVICE_PORT || process.env.PORT || '7100'), 10);
if (!Number.isInteger(SERVICE_PORT) || SERVICE_PORT <= 0 || SERVICE_PORT > 65535) {
    throw new Error('USERPERSISTO_SERVICE_PORT must be a valid TCP port.');
}

await getStore();
await ensureSeedData();
await ensureDevAdmin();
startService(SERVICE_PORT);

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
        const store = await getStore();
        await store.shutDown();
        process.exit(0);
    });
}
