import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('saveCurrentProfileAvatar broadcasts profile avatar updates to other browser contexts', async () => {
    const originalWindow = globalThis.window;
    const originalCustomEvent = globalThis.CustomEvent;
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const originalAssistOS = globalThis.assistOS;
    const dispatchedEvents = [];
    const channelMessages = [];
    const storage = new Map();

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
            getItem(key) {
                return storage.has(key) ? storage.get(key) : null;
            },
            setItem(key, value) {
                storage.set(key, value);
            }
        },
        assistOS: {
            user: {
                id: 'local:user',
                username: 'user',
                roles: ['user']
            }
        },
        location: { href: 'http://localhost/' }
    };
    globalThis.assistOS = globalThis.window.assistOS;

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
        assert.equal(JSON.parse(storage.get('assistOS.avatar-settings.updated') || '{}').config.style, 'terminal');
        assert.equal(JSON.parse(storage.get('assistOS.profileAvatar.settings') || '{}').config.style, 'terminal');
    } finally {
        globalThis.window = originalWindow;
        globalThis.CustomEvent = originalCustomEvent;
        globalThis.BroadcastChannel = originalBroadcastChannel;
        globalThis.assistOS = originalAssistOS;
    }
});

test('profile avatar source is localStorage only when a saved avatar config exists', async () => {
    const source = await fs.readFile(
        path.resolve(import.meta.dirname, '../../services/profileAvatar/avatarApi.js'),
        'utf8'
    );

    assert.match(source, /const hasStoredAvatar = Boolean\(stored && typeof stored === 'object' && stored\.config\);/);
    assert.match(source, /source: hasStoredAvatar \? \{ kind: 'localStorage' \} : \{ kind: 'fallback' \}/);
});
