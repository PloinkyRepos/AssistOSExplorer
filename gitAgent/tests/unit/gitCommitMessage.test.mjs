import test from 'node:test';
import assert from 'node:assert/strict';

import gitCommitMessage from '../../lib/git-commit-message.js';

function diffs(count) {
    return Array.from({ length: count }, (_, index) => ({
        filePath: `src/file-${index + 1}.js`,
        diff: `+change ${index + 1}`,
    }));
}

function responseExecutor(responses, prompts = []) {
    let callIndex = 0;
    return async (_agent, prompt) => {
        prompts.push(prompt);
        const response = responses[callIndex++];
        if (response instanceof Error) throw response;
        return response;
    };
}

test('small changes produce a complete commit message with one LLM call', async () => {
    const prompts = [];
    const expected = [
        'Add runtime recovery',
        '',
        '- Retry transient startup failures',
        '- Cover recovery behavior with tests',
    ].join('\n');

    const message = await gitCommitMessage(
        { diffs: diffs(3) },
        {
            llmAgent: {},
            executePromptWithTimeout: responseExecutor([expected], prompts),
        },
    );

    assert.equal(message, expected);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Write one complete Git commit message/);
});

test('batch synthesis uses successful semantic groups when other groups fail', async () => {
    const selectedDiffs = [
        { filePath: 'lib/runtime.js', diff: '+add runtime availability checks' },
        { filePath: 'tests/runtime.test.mjs', diff: '+cover runtime checks' },
        { filePath: 'docs/runtime.md', diff: '+document runtime recovery' },
    ];
    const responses = [
        'Add runtime availability checks.',
        new Error('provider_invalid_response'),
        'Document runtime recovery behavior.',
        new Error('provider_invalid_response'),
    ];

    const message = await gitCommitMessage(
        { diffs: selectedDiffs },
        {
            llmAgent: {},
            directPromptCharLimit: 0,
            executePromptWithTimeout: responseExecutor(responses),
        },
    );

    assert.equal(
        message,
        [
            'Add runtime availability checks',
            '',
            '- Document runtime recovery behavior.',
        ].join('\n'),
    );
});

test('batch synthesis ignores an empty final response', async () => {
    const selectedDiffs = [
        { filePath: 'lib/runtime.js', diff: '+add runtime loader' },
        { filePath: 'web-components/loader.html', diff: '+show retry feedback' },
    ];
    const responses = [
        'Add runtime loader.',
        'Improve retry feedback.',
        '',
    ];

    const message = await gitCommitMessage(
        { diffs: selectedDiffs },
        {
            llmAgent: {},
            directPromptCharLimit: 0,
            executePromptWithTimeout: responseExecutor(responses),
        },
    );

    assert.match(message, /^Add runtime loader$/m);
    assert.doesNotMatch(message, /^- Add runtime loader\.$/m);
    assert.match(message, /^- Improve retry feedback\.$/m);
});

test('batch synthesis returns a file-based message when every LLM call fails', async () => {
    const message = await gitCommitMessage(
        { diffs: diffs(2) },
        {
            llmAgent: {},
            directPromptCharLimit: 0,
            async executePromptWithTimeout() {
                throw new Error('provider unavailable');
            },
        },
    );

    assert.equal(
        message,
        [
            'Update project files',
            '',
            '- src/file-1.js',
            '- src/file-2.js',
        ].join('\n'),
    );
});

test('batch synthesis includes every file without a global file-count limit', async () => {
    const prompts = [];
    const fileCount = 85;
    const batchCount = Math.ceil(fileCount / 10);
    const responses = [
        ...Array.from({ length: batchCount }, (_, index) => `Update source group ${index + 1}.`),
        'Expand commit synthesis coverage',
    ];

    const message = await gitCommitMessage(
        { diffs: diffs(fileCount) },
        {
            llmAgent: {},
            directPromptCharLimit: 0,
            executePromptWithTimeout: responseExecutor(responses, prompts),
        },
    );

    assert.equal(message, 'Expand commit synthesis coverage');
    assert.equal(prompts.length, batchCount + 1);
    assert.match(prompts.at(-1), /src\/file-85\.js/);
});
