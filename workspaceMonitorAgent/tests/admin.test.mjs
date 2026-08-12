import assert from 'node:assert/strict';
import test from 'node:test';

import { assertAdministrator } from '../lib/admin.mjs';

test('Workspace Monitor tools admit administrators and reject participants', () => {
    assert.doesNotThrow(() => assertAdministrator({ roles: ['admin'] }));
    assert.doesNotThrow(() => assertAdministrator({ user: { roles: ['admin'] }, principalId: 'user:42' }));
    assert.doesNotThrow(() => assertAdministrator({ principalId: 'user:local:admin' }));
    assert.throws(() => assertAdministrator({ roles: ['user'] }), /requires an administrator/);
});
