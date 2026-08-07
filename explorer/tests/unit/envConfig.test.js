import test from 'node:test';
import assert from 'node:assert/strict';

import { getRequestedRoots } from '../../utils/server/env-config.mjs';

test('uses the Ploinky workspace root when no explicit roots are configured', () => {
    assert.deepEqual(
        getRequestedRoots([], { PLOINKY_WORKSPACE_ROOT: '/workspace/project' }),
        ['/workspace/project']
    );
});

test('explicit filesystem roots take precedence over the Ploinky workspace root', () => {
    assert.deepEqual(
        getRequestedRoots([], {
            ASSISTOS_FS_ROOT: '/explicit/one, /explicit/two',
            PLOINKY_WORKSPACE_ROOT: '/workspace/project'
        }),
        ['/explicit/one', '/explicit/two']
    );
    assert.deepEqual(
        getRequestedRoots([], {
            MCP_FS_ROOT: '/mcp/root',
            PLOINKY_WORKSPACE_ROOT: '/workspace/project'
        }),
        ['/mcp/root']
    );
});

test('command-line roots take precedence over the Ploinky workspace fallback', () => {
    assert.deepEqual(
        getRequestedRoots(['/command-line/root'], { PLOINKY_WORKSPACE_ROOT: '/workspace/project' }),
        ['/command-line/root']
    );
});
