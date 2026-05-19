import assert from 'node:assert/strict';
import test from 'node:test';

test('saveCurrentProfileAvatar broadcasts profile avatar updates to other browser contexts', async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    const originalCustomEvent = globalThis.CustomEvent;
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const dispatchedEvents = [];
    const storageWrites = [];
    const channelMessages = [];

    class TestCustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    }

    class TestBroadcastChannel {
        constructor(name) {
            this.name = name;
        }

        postMessage(message) {
            channelMessages.push({ name: this.name, message });
        }

        addEventListener() {}
    }

    globalThis.CustomEvent = TestCustomEvent;
    globalThis.BroadcastChannel = TestBroadcastChannel;
    globalThis.window = {
        dispatchEvent(event) {
            dispatchedEvents.push(event);
        },
        addEventListener() {},
        localStorage: {
            setItem(key, value) {
                storageWrites.push({ key, value });
            }
        },
        location: { href: 'http://localhost/' }
    };
    globalThis.fetch = async () => ({
        ok: true,
        async json() {
            return {
                ok: true,
                user: {
                    id: 'local:user',
                    username: 'user',
                    roles: ['user']
                },
                avatar: {
                    enabled: true,
                    config: {
                        agentId: 'profile:local:user',
                        generated: true,
                        seed: 'profile:local:user',
                        style: 'terminal',
                        palette: 'terminal'
                    },
                    fallbackLetter: 'U',
                    source: { kind: 'dpu' }
                }
            };
        }
    });

    try {
        const { saveCurrentProfileAvatar } = await import('../../services/profileAvatar/avatarApi.js');
        await saveCurrentProfileAvatar({
            enabled: true,
            config: {
                agentId: 'profile:local:user',
                generated: true,
                seed: 'profile:local:user',
                style: 'terminal',
                palette: 'terminal'
            }
        });

        assert.equal(dispatchedEvents[0]?.type, 'assistOS:avatar-settings-updated');
        assert.equal(dispatchedEvents[0]?.detail?.userId, 'local:user');
        assert.equal(dispatchedEvents[0]?.detail?.config?.style, 'terminal');
        assert.equal(channelMessages[0]?.name, 'assistOS.avatar-settings');
        assert.equal(channelMessages[0]?.message?.userId, 'local:user');
        assert.equal(storageWrites[0]?.key, 'assistOS.avatar-settings.updated');
        assert.equal(JSON.parse(storageWrites[0]?.value || '{}').config.style, 'terminal');
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        globalThis.CustomEvent = originalCustomEvent;
        globalThis.BroadcastChannel = originalBroadcastChannel;
    }
});
