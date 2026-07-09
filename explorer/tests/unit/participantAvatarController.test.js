import assert from 'node:assert/strict';
import test from 'node:test';

import { createParticipantProfileAvatarController } from '../../services/profileAvatar/participantAvatarController.js';

function profileAvatarSetting(size) {
    return {
        enabled: true,
        config: {
            agentId: 'profile:local:admin',
            generated: true,
            size,
            seed: 'profile:local:admin',
            style: 'sketch',
            palette: 'default'
        }
    };
}

test('local participant avatar refresh rereads stored profile data', async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    const originalAssistOS = globalThis.assistOS;
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const storage = new Map();
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('Local profile avatar refresh should not fetch profile data.');
    };
    globalThis.window = {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        localStorage: {
            getItem(key) {
                return storage.has(key) ? storage.get(key) : null;
            },
            setItem(key, value) {
                storage.set(key, value);
            },
            removeItem(key) {
                storage.delete(key);
            }
        },
        assistOS: {
            user: {
                id: 'local:admin',
                username: 'admin',
                roles: ['admin']
            }
        },
        location: { href: 'http://localhost/' }
    };
    globalThis.assistOS = globalThis.window.assistOS;
    globalThis.BroadcastChannel = class TestBroadcastChannel {
        addEventListener() {}
        postMessage() {}
        close() {}
    };

    try {
        const controller = createParticipantProfileAvatarController({
            getParticipantDisplayName: () => 'Admin',
            getParticipantAvatarUserId: (participant) => participant?.kind === 'local' ? 'me' : '',
            loadAxiFace: async () => {}
        });
        const view = {
            id: 'local-admin',
            name: 'Admin',
            avatarUserId: 'me'
        };
        const participant = {
            id: 'local-admin',
            identity: 'local-admin',
            displayName: 'Admin',
            kind: 'local'
        };

        storage.set('assistOS.profileAvatar.settings', JSON.stringify(profileAvatarSetting('72')));
        await controller.refresh(view, participant);
        assert.equal(view.avatarConfig?.size, '72');

        storage.set('assistOS.profileAvatar.settings', JSON.stringify(profileAvatarSetting('32')));
        await controller.refresh(view, participant);
        assert.equal(fetchCalls, 0);
        assert.equal(view.avatarConfig?.size, '32');
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        globalThis.assistOS = originalAssistOS;
        globalThis.BroadcastChannel = originalBroadcastChannel;
    }
});

test('remote participants without roster projection fall back without fetching another user avatar', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('Remote avatar fetch should not be attempted.');
    };

    try {
        const controller = createParticipantProfileAvatarController({
            getParticipantDisplayName: (participant) => participant?.displayName || participant?.identity || 'Participant',
            getParticipantAvatarUserId: (participant) => participant?.kind === 'local'
                ? 'me'
                : String(participant?.userId || '')
        });
        const view = {
            id: 'remote-1',
            name: 'Admin',
            avatarUserId: 'local:admin'
        };

        await controller.refresh(view, {
            id: 'remote-1',
            identity: 'remote-1',
            displayName: 'Admin',
            kind: 'remote',
            userId: 'local:admin'
        });

        assert.equal(fetchCalls, 0);
        assert.equal(view.avatarEnabled, false);
        assert.equal(view.avatarConfig, null);
        assert.equal(view.avatarResolved, true);
        assert.equal(view.avatarFallbackLetter, 'A');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('remote participants render roster-projected avatars without fetching another user avatar', async () => {
    const originalFetch = globalThis.fetch;
    const originalCustomElements = globalThis.customElements;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('Remote avatar fetch should not be attempted.');
    };
    globalThis.customElements = {
        get(name) {
            return name === 'axi-face' ? class AxiFaceStub {} : undefined;
        }
    };

    try {
        const controller = createParticipantProfileAvatarController({
            getParticipantDisplayName: (participant) => participant?.displayName || participant?.identity || 'Participant',
            getParticipantAvatarUserId: (participant) => participant?.kind === 'local'
                ? 'me'
                : String(participant?.userId || '')
        });
        const view = {
            id: 'remote-1',
            name: 'Admin',
            avatarUserId: 'local:admin'
        };

        await controller.refresh(view, {
            id: 'remote-1',
            identity: 'remote-1',
            displayName: 'Admin',
            kind: 'remote',
            userId: 'local:admin',
            profileAvatar: {
                enabled: true,
                fallbackLetter: 'A',
                config: {
                    agentId: 'profile:local:admin',
                    generated: true,
                    size: '48',
                    seed: 'profile:local:admin',
                    style: 'robot-soft',
                    palette: 'terminal'
                }
            }
        });

        assert.equal(fetchCalls, 0);
        assert.equal(view.avatarEnabled, true);
        assert.equal(view.avatarConfig?.seed, 'profile:local:admin');
        assert.equal(view.avatarResolved, true);
        assert.equal(view.avatarFallbackLetter, 'A');
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.customElements = originalCustomElements;
    }
});

test('remote roster-projected avatars are applied even when AxiFace loading is delayed or fails', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    let applyCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('Remote avatar fetch should not be attempted.');
    };

    try {
        const controller = createParticipantProfileAvatarController({
            getParticipantDisplayName: (participant) => participant?.displayName || participant?.identity || 'Participant',
            getParticipantAvatarUserId: (participant) => participant?.kind === 'local'
                ? 'me'
                : String(participant?.userId || ''),
            loadAxiFace: async () => {
                throw new Error('AxiFace module unavailable.');
            }
        });
        const view = {
            id: 'remote-2',
            name: 'User',
            avatarUserId: 'local:user'
        };

        await controller.refresh(view, {
            id: 'remote-2',
            identity: 'remote-2',
            displayName: 'User',
            kind: 'remote',
            userId: 'local:user',
            profileAvatar: {
                enabled: true,
                fallbackLetter: 'U',
                config: {
                    agentId: 'profile:local:user',
                    generated: true,
                    size: '72',
                    seed: 'profile:local:user',
                    style: 'robot-soft',
                    palette: 'default'
                }
            }
        }, () => {
            applyCalls += 1;
        });

        assert.equal(fetchCalls, 0);
        assert.equal(applyCalls >= 1, true);
        assert.equal(view.avatarEnabled, true);
        assert.equal(view.avatarConfig?.seed, 'profile:local:user');
        assert.equal(view.avatarResolved, true);
        assert.equal(view.avatarFallbackLetter, 'U');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('remote avatar refresh without participant clears stale projected avatar', async () => {
    const controller = createParticipantProfileAvatarController({
        getParticipantDisplayName: (participant) => participant?.displayName || participant?.identity || 'Participant',
        getParticipantAvatarUserId: (participant) => participant?.kind === 'local'
            ? 'me'
            : String(participant?.userId || '')
    });
    const view = {
        id: 'remote-3',
        name: 'User',
        avatarUserId: 'local:user',
        avatarEnabled: true,
        avatarResolved: true,
        avatarFallbackLetter: 'U',
        avatarConfig: {
            agentId: 'profile:local:user',
            generated: true,
            size: '96',
            seed: 'profile:local:user'
        }
    };
    let applied = false;

    await controller.refresh(view, null, () => {
        applied = true;
    });

    assert.equal(applied, true);
    assert.equal(view.avatarEnabled, false);
    assert.equal(view.avatarResolved, true);
    assert.equal(view.avatarConfig, null);
    assert.equal(view.avatarFallbackLetter, 'P');
});

test('avatar update broadcasts from another logged-in user do not refresh the local profile avatar', async () => {
    const originalWindow = globalThis.window;
    const listeners = new Map();
    globalThis.window = {
        addEventListener(name, handler) {
            listeners.set(name, handler);
        },
        removeEventListener() {}
    };

    try {
        let refreshed = false;
        const controller = createParticipantProfileAvatarController({
            getCurrentUserId: () => 'local:admin'
        });
        controller.bindUpdates(
            () => [{
                id: 'local-admin',
                avatarUserId: 'me'
            }],
            () => {
                refreshed = true;
            }
        );

        listeners.get('assistOS:avatar-settings-updated')?.({
            detail: {
                type: 'profile',
                userId: 'local:user'
            }
        });

        assert.equal(refreshed, false);
    } finally {
        globalThis.window = originalWindow;
    }
});
