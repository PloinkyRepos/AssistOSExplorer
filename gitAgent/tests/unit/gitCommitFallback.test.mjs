import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isLlmUnavailableError,
    buildFallbackCommitMessage
} from '../../IDE-plugins/git-tool-button/components/git-commit-modal/git-commit-modal-utils.js';

test('isLlmUnavailableError matches missing model configuration failures', () => {
    assert.equal(
        isLlmUnavailableError('No LLM models are configured in /code/node_modules/achillesAgentLib/LLMConfig.json.'),
        true
    );
    assert.equal(isLlmUnavailableError('No default LLM agent available.'), true);
    assert.equal(isLlmUnavailableError('Authentication failed.'), false);
});

test('buildFallbackCommitMessage uses specific filenames for a single repo selection', () => {
    assert.equal(
        buildFallbackCommitMessage([
            {
                repoPath: '/workspace/demo-repo',
                files: ['/workspace/demo-repo/README.md']
            }
        ]),
        'Update README.md'
    );

    assert.equal(
        buildFallbackCommitMessage([
            {
                repoPath: '/workspace/demo-repo',
                files: [
                    '/workspace/demo-repo/README.md',
                    '/workspace/demo-repo/src/index.js',
                    '/workspace/demo-repo/src/utils.js'
                ]
            }
        ]),
        'Update README.md and 2 more files'
    );
});

test('buildFallbackCommitMessage summarizes multi-repo selections', () => {
    assert.equal(
        buildFallbackCommitMessage([
            {
                repoPath: '/workspace/repo-a',
                files: ['/workspace/repo-a/README.md']
            },
            {
                repoPath: '/workspace/repo-b',
                files: ['/workspace/repo-b/index.js']
            }
        ]),
        'Sync changes across 2 repositories'
    );
});
