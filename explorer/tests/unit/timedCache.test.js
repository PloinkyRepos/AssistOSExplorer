import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimedCache } from '../../web-components/utils/timed-cache.js';

test('createTimedCache stores and returns values, tracking hit/miss stats', () => {
    const cache = createTimedCache({ ttlMs: 1000, maxEntries: 3 });
    cache.set('a', 1);

    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('missing'), null);

    const stats = cache.getStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.sets, 1);
    assert.equal(stats.size, 1);
});

test('createTimedCache evicts stale entries by ttl', async () => {
    const cache = createTimedCache({ ttlMs: 5, maxEntries: 3 });
    cache.set('a', 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(cache.get('a'), null);
    const stats = cache.getStats();
    assert.equal(stats.staleMisses, 1);
});

test('createTimedCache evicts oldest entries when maxEntries exceeded', () => {
    const cache = createTimedCache({ ttlMs: 1000, maxEntries: 2, refreshOnGet: false });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    assert.equal(cache.get('a'), null);
    assert.equal(cache.get('b'), 2);
    assert.equal(cache.get('c'), 3);

    const stats = cache.getStats();
    assert.equal(stats.evictions, 1);
});
