import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSecretsText } from '../../utils/server/onlyoffice/workspace-secrets.mjs';

test('parseSecretsText reads key value pairs and ignores comments', () => {
    const parsed = parseSecretsText(`
# comment
ONLYOFFICE_PUBLIC_URL=http://127.0.0.1:8082
ONLYOFFICE_JWT_SECRET=secret-value

INVALID_LINE
`);

    assert.deepEqual(parsed, {
        ONLYOFFICE_PUBLIC_URL: 'http://127.0.0.1:8082',
        ONLYOFFICE_JWT_SECRET: 'secret-value'
    });
});
