import assert from 'node:assert/strict';
import test from 'node:test';

import { pullWithAutoStashFlow } from '../../IDE-plugins/git-tool-button/utils/git-auto-stash-flow.js';

function localChangesStatus() {
    return {
        branch: 'main',
        upstream: 'origin/main',
        status: {
            staged: [],
            unstaged: [{ path: 'src/app.js' }],
            untracked: [],
            conflicted: []
        }
    };
}

test('auto-pull restores its stash before returning a pull error', async () => {
    const events = [];
    const result = await pullWithAutoStashFlow({
        service: {
            async gitStatus() {
                events.push('status');
                return localChangesStatus();
            },
            async gitStash() {
                events.push('stash');
                return { ok: true, created: true, ref: 'stash@{0}' };
            }
        },
        repoPath: '/workspace/repo',
        async gitPullWithToken() {
            events.push('pull');
            throw new Error('provider unavailable');
        },
        async restoreStash(repoPath, stashRef) {
            events.push(`restore:${repoPath}:${stashRef}`);
            return { ok: true, conflicts: false };
        }
    });

    events.push('returned');
    assert.deepEqual(events, [
        'status',
        'stash',
        'pull',
        'restore:/workspace/repo:stash@{0}',
        'returned'
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'pull_error');
    assert.equal(result.rollback.ok, true);
});

test('a failed stash restore takes precedence over the original pull error', async () => {
    const result = await pullWithAutoStashFlow({
        service: {
            async gitStatus() {
                return localChangesStatus();
            },
            async gitStash() {
                return { ok: true, created: true, ref: 'stash@{3}' };
            }
        },
        repoPath: '/workspace/repo',
        async gitPullWithToken() {
            throw new Error('authentication failed');
        },
        async restoreStash() {
            return { ok: false, conflicts: true, message: 'Conflicts after restoring stashed changes.' };
        }
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'restore_failed');
    assert.equal(result.message, 'Conflicts after restoring stashed changes.');
    assert.equal(result.originalReason, 'auth');
    assert.equal(result.stashCreated, true);
    assert.equal(result.stashRef, 'stash@{3}');
    assert.equal(result.conflicts, true);
});
