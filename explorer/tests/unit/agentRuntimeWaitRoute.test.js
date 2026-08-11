import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildAgentRuntimeWaitUrl,
    parseAgentRuntimeWaitRoute,
    probeAgentRuntimeMcp,
    probeAgentRuntimeRouteStability,
    probeAgentRuntimeTarget,
    resolveAgentRuntimeTarget
} from '../../shared/ui/agent-runtime-loader/agent-runtime-wait-route.js';

const ORIGIN = 'http://localhost:8080';

test('builds and parses a same-agent Explorer waiting route', () => {
    const waitingUrl = buildAgentRuntimeWaitUrl({
        agentRef: 'AchillesIDE/webmeetAgent',
        label: 'WebMeet',
        targetUrl: '/webmeetAgent/roomLoader.html?roomId=room_123'
    }, ORIGIN);
    const parsed = parseAgentRuntimeWaitRoute(waitingUrl.hash, ORIGIN);

    assert.equal(waitingUrl.pathname, '/explorer/index.html');
    assert.equal(parsed.agentRef, 'AchillesIDE/webmeetAgent');
    assert.equal(parsed.label, 'WebMeet');
    assert.equal(parsed.targetUrl.toString(), `${ORIGIN}/webmeetAgent/roomLoader.html?roomId=room_123`);
});

test('rejects cross-origin and cross-agent targets', () => {
    assert.throws(
        () => resolveAgentRuntimeTarget({
            agentRef: 'AchillesIDE/webmeetAgent',
            target: 'https://example.test/webmeetAgent/roomLoader.html'
        }, ORIGIN),
        /target is invalid/
    );
    assert.throws(
        () => resolveAgentRuntimeTarget({
            agentRef: 'AchillesIDE/webmeetAgent',
            target: '/onlyOffice/index.html'
        }, ORIGIN),
        /target is invalid/
    );
});

test('runtime target probe exposes transient HTTP status to the shared loader', async () => {
    const targetUrl = new URL('/webmeetAgent/roomLoader.html', ORIGIN);
    await assert.rejects(
        () => probeAgentRuntimeTarget(targetUrl, async () => ({ ok: false, status: 404 })),
        (error) => error.status === 404 && error.code === 'agent_not_ready'
    );

    let bodyCancelled = false;
    const result = await probeAgentRuntimeTarget(targetUrl, async () => ({
        ok: true,
        status: 200,
        redirected: false,
        body: { cancel: async () => { bodyCancelled = true; } }
    }));
    assert.equal(result, targetUrl);
    assert.equal(bodyCancelled, true);
});

test('runtime MCP probe waits for a complete agent handshake', async () => {
    let requestedAgent = '';
    let listed = 0;
    const sdk = {
        getClient(agentName) {
            requestedAgent = agentName;
            return {
                async listTools() {
                    listed += 1;
                    return [];
                }
            };
        }
    };

    const result = await probeAgentRuntimeMcp('AchillesIDE/webmeetAgent', sdk);
    assert.equal(result, 'webmeetAgent');
    assert.equal(requestedAgent, 'webmeetAgent');
    assert.equal(listed, 1);
});

test('runtime MCP probe exposes startup failures as retryable availability errors', async () => {
    const sdk = {
        getClient() {
            return {
                async listTools() {
                    throw new Error('fetch failed');
                }
            };
        }
    };

    await assert.rejects(
        () => probeAgentRuntimeMcp('AchillesIDE/webmeetAgent', sdk),
        (error) => error.code === 'agent_not_ready' && /fetch failed/.test(error.message)
    );
});

test('runtime route probe requires one stable Router generation window', async () => {
    const generations = ['generation-1', 'generation-1'];
    const waits = [];
    const result = await probeAgentRuntimeRouteStability('AchillesIDE/webmeetAgent', {
        origin: ORIGIN,
        settleMs: 2500,
        wait: async (delayMs) => waits.push(delayMs),
        fetchImpl: async (url) => ({
            ok: true,
            status: 200,
            async json() {
                const parsed = new URL(url);
                assert.equal(parsed.searchParams.get('mutationRoute'), 'webmeetAgent');
                assert.equal(parsed.searchParams.has('mutationPath'), false);
                return {
                    browserMutation: {
                        generation: generations.shift(),
                        routeKey: 'webmeetAgent',
                        origin: ORIGIN
                    }
                };
            }
        })
    });

    assert.equal(result, 'generation-1');
    assert.deepEqual(waits, [2500]);
});

test('runtime route probe retries when the Router generation changes', async () => {
    const generations = ['generation-1', 'generation-2'];
    await assert.rejects(
        () => probeAgentRuntimeRouteStability('AchillesIDE/webmeetAgent', {
            origin: ORIGIN,
            wait: async () => {},
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                async json() {
                    return {
                        browserMutation: {
                            generation: generations.shift(),
                            routeKey: 'webmeetAgent',
                            origin: ORIGIN
                        }
                    };
                }
            })
        }),
        (error) => error.code === 'agent_not_ready' && /still being updated/.test(error.message)
    );
});
