import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startService } from '../service/index.mjs';
import { resetStoreForTests } from '../lib/store.mjs';
import { ensureSeedData } from '../lib/bootstrap.mjs';
import { createProvider, resolveProviderConfig } from '../runtime/index.mjs';

test('SSO sends browsers to the public callback origin while provider calls stay private', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'userpersisto-public-login-'));
    process.env.PERSISTENCE_FOLDER = folder;
    process.env.USERPERSISTO_SETTINGS_KEY = 'test-public-login-settings';
    process.env.USERPERSISTO_RUNTIME_SECRET = 'test-public-login-runtime';
    process.env.USERPERSISTO_ALLOWED_REDIRECT_ORIGINS = 'https://workspace.example.test';
    let server;
    try {
        await ensureSeedData();
        server = startService({ port: 0, host: '127.0.0.1' });
        if (!server.listening) await once(server, 'listening');
        const privateBase = `http://127.0.0.1:${server.address().port}`;
        const requests = [];
        server.on('request', (req) => requests.push(req.url));
        const config = resolveProviderConfig({
            providerConfig: { routerBaseUrl: privateBase, runtimePath: '/service/runtime' },
            readValue: () => process.env.USERPERSISTO_RUNTIME_SECRET,
        });
        const provider = createProvider({ getConfig: async () => config });
        for (const origin of ['https://workspace.example.test', 'http://localhost:9912']) {
            const started = await provider.sso_begin_login({ redirectUri: `${origin}/auth/callback` });
            const url = new URL(started.authorizationUrl);
            assert.equal(url.origin, origin);
            assert.equal(url.pathname, '/base-agent-additional-server/userPersistoAgent/7000/service/auth/');
            assert.equal(url.searchParams.get('requestId'), started.providerState);
            assert.equal(url.searchParams.get('state'), started.providerState);
        }
        assert.deepEqual(requests, ['/service/runtime/sso-login-request', '/service/runtime/sso-login-request']);
        assert.equal(config.routerBaseUrl, privateBase);
        await assert.rejects(() => provider.sso_begin_login({ redirectUri: 'javascript:alert(1)' }));
        await assert.rejects(() => provider.sso_begin_login({ redirectUri: 'https://user:password@workspace.example.test/auth/callback' }));
    } finally {
        if (server?.listening) await new Promise((resolve) => server.close(resolve));
        await resetStoreForTests();
        await rm(folder, { recursive: true, force: true });
        delete process.env.USERPERSISTO_ALLOWED_REDIRECT_ORIGINS;
    }
});
