import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeOptimisticSearchMatchesAfterReplace,
    mergeSearchMatchesByPaths,
    withTimeout
} from '../../web-components/utils/workspace-search-utils.js';

test('withTimeout resolves when task completes in time', async () => {
    const result = await withTimeout(
        async () => 'ok',
        { timeoutMs: 50, timeoutMessage: 'timed out' }
    );
    assert.equal(result, 'ok');
});

test('withTimeout rejects when task exceeds timeout', async () => {
    await assert.rejects(
        () => withTimeout(
            () => new Promise((resolve) => setTimeout(() => resolve('late'), 50)),
            { timeoutMs: 5, timeoutMessage: 'timed out' }
        ),
        /timed out/
    );
});

test('mergeSearchMatchesByPaths replaces only refreshed file matches', () => {
    const merged = mergeSearchMatchesByPaths({
        currentMatches: [
            { id: '1', path: '/a.txt', line: 1, column: 1 },
            { id: '2', path: '/b.txt', line: 1, column: 1 }
        ],
        refreshedPaths: ['/a.txt'],
        refreshedMatches: [
            { id: '3', path: '/a.txt', line: 2, column: 1 }
        ]
    });

    assert.deepEqual(
        merged.map((item) => item.id),
        ['3', '2']
    );
});

test('computeOptimisticSearchMatchesAfterReplace drops selected and changed files', () => {
    const next = computeOptimisticSearchMatchesAfterReplace({
        matches: [
            { id: 'a', path: '/x.txt' },
            { id: 'b', path: '/x.txt' },
            { id: 'c', path: '/y.txt' }
        ],
        selectedOnly: true,
        selectedIds: ['a'],
        changedFiles: ['/x.txt'],
        replacements: 1
    });

    assert.deepEqual(
        next.map((item) => item.id),
        ['c']
    );
});
