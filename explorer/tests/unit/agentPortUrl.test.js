import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentPortUrl } from '../../services/runtime/agent-port-url.js';

test('buildAgentPortUrl uses the Ploinky confined agent-port convention', () => {
    assert.equal(
        buildAgentPortUrl('webtty', 7681),
        '/base-agent-additional-server/webtty/7681/'
    );
    assert.equal(
        buildAgentPortUrl('onlyOffice', 8080, '/web-apps/apps/api/documents/api.js'),
        '/base-agent-additional-server/onlyOffice/8080/web-apps/apps/api/documents/api.js'
    );
});

test('buildAgentPortUrl rejects incomplete or non-canonical selectors', () => {
    assert.throws(() => buildAgentPortUrl('', 7681), /valid agent route key and port/i);
    assert.throws(() => buildAgentPortUrl('webtty', 0), /valid agent route key and port/i);
    assert.throws(() => buildAgentPortUrl('webtty', 1.5), /valid agent route key and port/i);
});
