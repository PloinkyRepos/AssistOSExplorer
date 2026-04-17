import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildPrefilledGitIdentityState
} from '../../IDE-plugins/git-tool-button/components/git-commit-modal/git-commit-modal-utils.js';

test('buildPrefilledGitIdentityState uses GitHub identity even without an explicit repo path', () => {
    const result = buildPrefilledGitIdentityState({
        identityPrompt: {
            visible: true,
            repoPath: null,
            pendingAction: null,
            name: '',
            email: ''
        },
        repoPath: '',
        rememberedIdentity: { name: '', email: '' },
        githubUser: {
            login: 'skutner',
            name: 'Sava Daniel',
            email: 'sava.dumitru.daniel@gmail.com'
        },
        authMethod: 'github'
    });

    assert.deepEqual(result.identityPrompt, {
        visible: true,
        repoPath: null,
        pendingAction: null,
        name: 'Sava Daniel',
        email: 'sava.dumitru.daniel@gmail.com'
    });
    assert.deepEqual(result.credentialsBaseline, {
        name: 'Sava Daniel',
        email: 'sava.dumitru.daniel@gmail.com',
        authMethod: 'github'
    });
});

test('buildPrefilledGitIdentityState preserves a selected repo path when present', () => {
    const result = buildPrefilledGitIdentityState({
        identityPrompt: {
            visible: true,
            repoPath: '/workspace/demo-repo',
            pendingAction: null,
            name: '',
            email: ''
        },
        repoPath: '',
        rememberedIdentity: { name: '', email: '' },
        githubUser: {
            login: 'skutner',
            name: 'Sava Daniel',
            email: 'sava.dumitru.daniel@gmail.com'
        },
        authMethod: 'github'
    });

    assert.equal(result.identityPrompt.repoPath, '/workspace/demo-repo');
    assert.equal(result.identityPrompt.name, 'Sava Daniel');
    assert.equal(result.identityPrompt.email, 'sava.dumitru.daniel@gmail.com');
});
