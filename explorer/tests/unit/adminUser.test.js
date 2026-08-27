import test from 'node:test';
import assert from 'node:assert/strict';

import { isAdminUser } from '../../services/auth/adminUser.js';

test('administrator presentation uses one explicit normalized identity predicate', () => {
    for (const user of [
        { roles: ['ADMIN'] },
        { username: ' Admin ' },
        { id: 'LOCAL:ADMIN' },
        { userId: 'local:admin' }
    ]) {
        assert.equal(isAdminUser(user), true, JSON.stringify(user));
    }
    for (const user of [
        null,
        {},
        { roles: 'admin' },
        { roles: ['user'], username: 'administrator', id: 'local:user' },
        { canManageAgents: true }
    ]) {
        assert.equal(isAdminUser(user), false, JSON.stringify(user));
    }
});
