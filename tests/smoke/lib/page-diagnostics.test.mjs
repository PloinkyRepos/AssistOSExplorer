import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {assertPageDiagnosticsClean, attachPageDiagnostics} from './fixtures.mjs';

test('page cleanliness requires a ledger and rejects any unacknowledged failure without clearing evidence', () => {
    const page = new EventEmitter();
    assert.throws(() => assertPageDiagnosticsClean(page), /no attached diagnostic controller/);
    const first = attachPageDiagnostics(page, {}, 'first');
    const second = attachPageDiagnostics(page, {}, 'second');
    assert.doesNotThrow(() => assertPageDiagnosticsClean(page));
    page.emit('pageerror', new Error('unhandled fixture error'));
    assert.throws(() => assertPageDiagnosticsClean(page), /browser console, page, or network errors/);
    assert.equal(first.actionableEvents().length, 1);
    assert.equal(second.actionableEvents().length, 1);
    assert.throws(() => assertPageDiagnosticsClean(page), /browser console, page, or network errors/);
    assert.equal(first.events.length, 1, 'checking twice must not acknowledge or remove an error');
});
