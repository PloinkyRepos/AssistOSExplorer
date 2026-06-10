import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fetchOnlyOfficeSession } from '../../services/onlyoffice/onlyoffice-preview-service.js';
import { createOnlyOfficeHttpHandler } from '../../utils/server/onlyoffice/onlyoffice-http-routes.mjs';

test('editor host opens sessions through /services/onlyoffice/office/session', async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return {
            ok: true,
            headers: {
                get(name) {
                    return name === 'content-type' ? 'application/json' : '';
                }
            },
            async json() {
                return {
                    ok: true,
                    config: { document: { title: 'report.docx' } }
                };
            }
        };
    };

    try {
        const session = await fetchOnlyOfficeSession('/docs/report.docx');
        assert.equal(session.ok, true);
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(calls, [
        {
            url: '/services/onlyoffice/office/session?path=%2Fdocs%2Freport.docx',
            options: {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                    accept: 'application/json'
                }
            }
        }
    ]);
});

test('explorer manifest no longer declares anonymous public office document routes', () => {
    const manifest = JSON.parse(
        readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')
    );
    const prefixes = (manifest.httpServices || []).map((entry) => entry.externalPrefix);

    assert.equal(prefixes.includes('/public-services/explorer/office/'), false);
    assert.equal(prefixes.includes('/services/explorer/office/'), false);
});

test('explorer enables OnlyOfficeAgent with workspace-root access for direct disk persistence', () => {
    const manifest = JSON.parse(
        readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')
    );

    assert.ok(
        (manifest.enable || []).some((entry) => entry === 'onlyOffice global'),
        'OnlyOfficeAgent must run in global mode so non-Confidential documents resolve under PLOINKY_WORKSPACE_ROOT'
    );
});

test('explorer server does not register office document or callback routes after cutover', async () => {
    const handler = createOnlyOfficeHttpHandler({});
    const noopRes = {};

    assert.equal(
        await handler(
            { method: 'GET' },
            noopRes,
            new URL('http://127.0.0.1/office/session')
        ),
        false
    );
    assert.equal(
        await handler(
            { method: 'GET' },
            noopRes,
            new URL('http://127.0.0.1/office/document/token-1')
        ),
        false
    );
    assert.equal(
        await handler(
            { method: 'POST' },
            noopRes,
            new URL('http://127.0.0.1/office/callback/token-1')
        ),
        false
    );
});
