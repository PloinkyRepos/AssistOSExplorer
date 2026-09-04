import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AgentRuntimeLoader,
    isAgentRuntimeStartupError,
    isTerminalAgentRuntimeState,
    waitForAgentRuntimeAvailability
} from '../../shared/ui/agent-runtime-loader/agent-runtime-loader.js';

test('runtime loader implements the complete WebSkel presenter lifecycle', () => {
    let invalidations = 0;
    const presenter = new AgentRuntimeLoader({}, () => {
        invalidations += 1;
    });

    assert.equal(invalidations, 1);
    assert.equal(typeof presenter.beforeRender, 'function');
    assert.equal(typeof presenter.afterRender, 'function');
    assert.equal(typeof presenter.afterUnload, 'function');
    assert.equal(presenter.beforeRender(), undefined);
});

test('runtime loader retries only transport and startup availability errors', () => {
    assert.equal(isAgentRuntimeStartupError(Object.assign(new Error('request failed'), { status: 503 })), true);
    assert.equal(isAgentRuntimeStartupError(Object.assign(new Error('document not found'), { status: 404 })), false);
    assert.equal(isAgentRuntimeStartupError(Object.assign(new Error('agent route not found'), { status: 404, code: 'agent_not_ready' })), true);
    assert.equal(isAgentRuntimeStartupError(new Error("Agent 'webmeetAgent' is still starting")), true);
    assert.equal(isAgentRuntimeStartupError(new Error('fetch failed')), true);
    assert.equal(isAgentRuntimeStartupError(Object.assign(new Error('permission denied'), { status: 403 })), false);
    assert.equal(isAgentRuntimeStartupError(new Error('document not found')), false);
});

test('runtime loader waits through stopped state and stops only for actual failures', () => {
    assert.equal(isTerminalAgentRuntimeState('stopped'), false);
    assert.equal(isTerminalAgentRuntimeState('starting'), false);
    assert.equal(isTerminalAgentRuntimeState('failed'), true);
    assert.equal(isTerminalAgentRuntimeState('exited'), true);
    assert.equal(isTerminalAgentRuntimeState('dead'), true);
});

test('runtime availability waits through stopped state until the operation succeeds', async () => {
    let attempts = 0;
    let reads = 0;
    const result = await waitForAgentRuntimeAvailability({
        agentRef: 'AchillesIDE/webmeetAgent',
        timeoutMs: Number.POSITIVE_INFINITY,
        readRuntime: async () => (++reads === 1 ? { status: 'stopped', running: false } : { status: 'running', running: true }),
        wait: async () => {},
        operation: async () => {
            attempts += 1;
            if (attempts === 1) {
                const error = new Error('WebMeet is not ready');
                error.code = 'agent_not_ready';
                throw error;
            }
            return 'ready';
        }
    });

    assert.equal(result, 'ready');
    assert.equal(attempts, 2);
    assert.equal(reads, 3);
});

test('runtime availability surfaces a terminal runtime failure', async () => {
    await assert.rejects(
        () => waitForAgentRuntimeAvailability({
            agentRef: 'AchillesIDE/webmeetAgent',
            label: 'WebMeet',
            readRuntime: async () => ({ status: 'failed', running: false }),
            operation: async () => 'unreachable'
        }),
        /WebMeet failed to start \(failed\)/
    );
});


test('runtime availability never calls application operations while startup is pending', async () => {
    let elapsed = 0;
    await assert.rejects(() => waitForAgentRuntimeAvailability({
        agentRef: 'AchillesCLI/achilles-cli', timeoutMs: 1000, pollIntervalMs: 250,
        now: () => elapsed,
        readRuntime: async () => ({ status: 'starting', running: false }),
        wait: async ms => { elapsed += ms; },
        operation: async () => assert.fail('MCP must not initialize before runtime readiness'),
    }), /startup timeout/);
});
