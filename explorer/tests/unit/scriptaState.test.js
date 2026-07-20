import test from 'node:test';
import assert from 'node:assert/strict';

import {
    addScriptaVariant,
    applyScriptaVote,
    deleteScriptaVariant,
    ensureScriptaInitialVariant,
    getScriptaViewerVote,
    getScriptaWinningVariant,
    normalizeScriptaState,
} from '../../shared/document/scripta-state.js';

test('SCRIPTA keeps one reaction per participant and updates the active text', () => {
    const paragraph = { text: 'Initial', metadata: {} };
    ensureScriptaInitialVariant(paragraph, { createdBy: 'author', now: '2026-01-01T00:00:00.000Z' });
    const alternative = addScriptaVariant(paragraph, 'Alternative', {
        createdBy: 'author',
        now: '2026-01-02T00:00:00.000Z',
    });

    applyScriptaVote(paragraph, {
        variantId: alternative.id,
        userHash: 'participant-a',
        userLabel: 'A',
        type: 'like',
    });
    let state = normalizeScriptaState(paragraph);

    assert.equal(getScriptaWinningVariant(state).id, alternative.id);
    assert.equal(paragraph.text, 'Alternative');
    assert.deepEqual(getScriptaViewerVote(state, 'participant-a'), { variantId: alternative.id, type: 'like' });

    applyScriptaVote(paragraph, {
        variantId: state.variants[0].id,
        userHash: 'participant-a',
        userLabel: 'A',
        type: 'dislike',
    });
    state = normalizeScriptaState(paragraph);
    assert.deepEqual(getScriptaViewerVote(state, 'participant-a'), {
        variantId: state.variants[0].id,
        type: 'dislike',
    });
});

test('SCRIPTA winner tie-breaking is deterministic', () => {
    const paragraph = { text: 'First', metadata: {} };
    const state = ensureScriptaInitialVariant(paragraph, {
        createdBy: 'author',
        now: '2026-01-01T00:00:00.000Z',
    });
    addScriptaVariant(paragraph, 'Second', {
        createdBy: 'author',
        now: '2026-01-02T00:00:00.000Z',
    });
    assert.equal(getScriptaWinningVariant(state).text, 'First');
});

test('SCRIPTA variants always expose text as a string', () => {
    const paragraph = { text: '', metadata: {} };
    const state = ensureScriptaInitialVariant(paragraph, {
        createdBy: 'author',
        now: '2026-01-01T00:00:00.000Z',
    });

    assert.equal(Object.hasOwn(state.variants[0], 'text'), true);
    assert.equal(state.variants[0].text, '');
});

test('only the variant owner can delete it while every participant can vote', () => {
    const paragraph = { text: 'Initial', metadata: {} };
    let state = ensureScriptaInitialVariant(paragraph, {
        createdBy: 'owner-a',
        now: '2026-01-01T00:00:00.000Z',
    });
    const alternative = addScriptaVariant(paragraph, 'Alternative', {
        createdBy: 'owner-a',
        now: '2026-01-02T00:00:00.000Z',
    });

    applyScriptaVote(paragraph, {
        variantId: alternative.id,
        userHash: 'participant-b',
        userLabel: 'B',
        type: 'like',
    });
    state = normalizeScriptaState(paragraph);
    assert.equal(state.reactionsByVariant[alternative.id]['participant-b'].type, 'like');
    assert.throws(
        () => deleteScriptaVariant(paragraph, alternative.id, { deletedBy: 'participant-b' }),
        (error) => error?.code === 'scripta_variant_forbidden'
    );

    deleteScriptaVariant(paragraph, alternative.id, { deletedBy: 'owner-a' });
    state = normalizeScriptaState(paragraph);
    assert.equal(state.variants.length, 1);
    assert.equal(state.reactionsByVariant[alternative.id], undefined);
    assert.throws(
        () => deleteScriptaVariant(paragraph, state.variants[0].id, { deletedBy: 'owner-a' }),
        /must keep at least one variant/
    );
});
