import assert from 'node:assert/strict';
import test from 'node:test';

import { dashboardDataMethods } from '../../IDE-plugins/webmeet-tool-button/components/webmeet-dashboard/controllers/dashboard-data-methods.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

function createDashboard(t, { admin = true, callTool } = {}) {
    const calls = [];
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: {
            webSkel: { appServices: { getClient: () => ({
                callTool(name, args) {
                    calls.push({ name, args });
                    return callTool(name, args);
                },
            }) } },
        },
    });
    t.after(() => {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        else delete globalThis.window;
    });
    const errors = [];
    const dashboard = {
        ...dashboardDataMethods,
        meetingDetailsLoadSeq: 0,
        state: {
            meetings: [{ id: 'room-a' }, { id: 'room-b' }],
            selectedMeetingId: 'room-a',
            chat: [{ id: 'old-chat' }],
            resources: [{ resourceId: 'old-resource' }],
            agents: [{ id: 'old-agent' }],
            participants: [{ id: 'live-participant' }],
            participantAudioSettings: { 'live-participant': { volume: 0.5 } },
            session: { participantIdentity: 'live-participant' },
        },
        get selectedMeeting() {
            return this.state.meetings.find((meeting) => meeting.id === this.state.selectedMeetingId);
        },
        isGuestSession: () => false,
        canManageRooms: () => admin,
        loadParticipantAudioSettings() {},
        setError: (message) => errors.push(message),
    };
    return { dashboard, calls, errors };
}

test('room details start all administrator reads before the snapshot resolves and apply them together', async (t) => {
    const snapshot = deferred();
    const { dashboard, calls } = createDashboard(t, {
        callTool: (name) => {
            if (name === 'webmeet_room_get') return snapshot.promise;
            if (name === 'webmeet_chat_list') return { messages: [{ id: 'new-chat' }] };
            if (name === 'webmeet_resource_list') return { resources: [{ resourceId: 'new-resource' }] };
            assert.fail(`Unexpected tool: ${name}`);
        },
    });
    const previousState = structuredClone(dashboard.state);
    const loading = dashboard.loadMeetingDetails({ includeParticipants: true });
    const initialCalls = structuredClone(calls);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(dashboard.state, previousState, 'Partial results must not render before the snapshot.');
    snapshot.resolve({ agents: [{ id: 'new-agent' }], participants: [{ id: 'stale-participant' }] });
    await loading;

    assert.deepEqual(initialCalls, [
        { name: 'webmeet_room_get', args: { roomId: 'room-a', includeParticipants: false } },
        { name: 'webmeet_chat_list', args: { roomId: 'room-a' } },
        { name: 'webmeet_resource_list', args: { roomId: 'room-a' } },
    ]);
    assert.deepEqual(dashboard.state.chat, [{ id: 'new-chat' }]);
    assert.deepEqual(dashboard.state.resources, [{ resourceId: 'new-resource' }]);
    assert.deepEqual(dashboard.state.agents, [{ id: 'new-agent' }]);
    assert.deepEqual(dashboard.state.participants, previousState.participants, 'Detail refreshes must preserve the live roster.');
});

test('ordinary members read snapshot and chat concurrently without requesting administrative resources', async (t) => {
    const snapshot = deferred();
    const { dashboard, calls } = createDashboard(t, {
        admin: false,
        callTool: (name) => {
            if (name === 'webmeet_room_get') return snapshot.promise;
            if (name === 'webmeet_chat_list') return { messages: [{ id: 'member-chat' }] };
            assert.fail(`Unexpected tool: ${name}`);
        },
    });
    const loading = dashboard.loadMeetingDetails();
    const initialNames = calls.map((call) => call.name);
    snapshot.resolve({ agents: [{ id: 'administrative-agent' }] });
    await loading;

    assert.deepEqual(initialNames, ['webmeet_room_get', 'webmeet_chat_list']);
    assert.deepEqual(dashboard.state.chat, [{ id: 'member-chat' }]);
    assert.deepEqual(dashboard.state.resources, []);
    assert.deepEqual(dashboard.state.agents, []);
});

test('overlapping loads reuse the pending snapshot and discard the earlier chat response', async (t) => {
    const snapshot = deferred();
    const firstChat = deferred();
    let chatCalls = 0;
    const { dashboard, calls } = createDashboard(t, {
        admin: false,
        callTool: (name) => {
            if (name === 'webmeet_room_get') return snapshot.promise;
            if (name === 'webmeet_chat_list') {
                chatCalls += 1;
                return chatCalls === 1 ? firstChat.promise : { messages: [{ id: 'latest-chat' }] };
            }
            assert.fail(`Unexpected tool: ${name}`);
        },
    });
    const firstLoad = dashboard.loadMeetingDetails();
    const latestLoad = dashboard.loadMeetingDetails();
    snapshot.resolve({ agents: [] });
    await latestLoad;
    firstChat.resolve({ messages: [{ id: 'outdated-chat' }] });
    await firstLoad;

    assert.equal(calls.filter((call) => call.name === 'webmeet_room_get').length, 1);
    assert.equal(chatCalls, 2);
    assert.deepEqual(dashboard.state.chat, [{ id: 'latest-chat' }]);
});

test('changing the selected room discards completed reads even without another detail load', async (t) => {
    const snapshot = deferred();
    const { dashboard } = createDashboard(t, {
        callTool: (name) => name === 'webmeet_room_get'
            ? snapshot.promise
            : { messages: [{ id: 'room-a-chat' }], resources: [{ resourceId: 'room-a-resource' }] },
    });
    const loading = dashboard.loadMeetingDetails();
    dashboard.state.selectedMeetingId = 'room-b';
    const selectedRoomState = structuredClone(dashboard.state);
    snapshot.resolve({ agents: [{ id: 'room-a-agent' }] });
    await loading;

    assert.deepEqual(dashboard.state, selectedRoomState);
});

for (const stillListed of [false, true]) {
    test(`snapshot missing-room recovery wins over an earlier resource failure (still listed: ${stillListed})`, async (t) => {
        const snapshot = deferred();
        const { dashboard, errors } = createDashboard(t, {
            callTool: (name) => {
                if (name === 'webmeet_room_get') return snapshot.promise;
                if (name === 'webmeet_resource_list') return Promise.reject(new Error('Room not found.'));
                return { messages: [{ id: 'partial-chat' }] };
            },
        });
        const previousState = structuredClone(dashboard.state);
        const recoveredRooms = [];
        dashboard.refreshMeetingsAfterMissingMeeting = async (roomId) => {
            recoveredRooms.push(roomId);
            return stillListed;
        };
        const loading = dashboard.loadMeetingDetails();
        await new Promise((resolve) => setImmediate(resolve));
        snapshot.reject(new Error('Meeting not found.'));
        await loading;

        assert.deepEqual(recoveredRooms, ['room-a']);
        if (stillListed) {
            assert.deepEqual(dashboard.state, previousState);
            assert.deepEqual(errors, []);
        } else {
            assert.deepEqual(dashboard.state.meetings, [{ id: 'room-b' }]);
            assert.equal(dashboard.state.selectedMeetingId, '');
            assert.equal(dashboard.state.session, null);
            for (const key of ['chat', 'resources', 'agents', 'participants']) {
                assert.deepEqual(dashboard.state[key], []);
            }
            assert.deepEqual(dashboard.state.participantAudioSettings, {});
            assert.deepEqual(errors, ['Room is no longer available. Refreshing rooms.']);
        }
    });
}

test('missing-room recovery cannot clear a room selected while the refresh was pending', async (t) => {
    const refresh = deferred();
    const refreshStarted = deferred();
    const { dashboard, errors } = createDashboard(t, {
        admin: false,
        callTool: () => Promise.reject(new Error('Meeting not found.')),
    });
    dashboard.refreshMeetingsAfterMissingMeeting = () => {
        refreshStarted.resolve();
        return refresh.promise;
    };
    const loading = dashboard.loadMeetingDetails();
    await refreshStarted.promise;
    dashboard.state.selectedMeetingId = 'room-b';
    const selectedRoomState = structuredClone(dashboard.state);
    refresh.resolve(false);
    await loading;

    assert.deepEqual(dashboard.state, selectedRoomState);
    assert.deepEqual(errors, []);
});

for (const failedTool of ['webmeet_room_get', 'webmeet_chat_list', 'webmeet_resource_list']) {
    test(`authorization failure from ${failedTool} surfaces without applying any concurrent result`, async (t) => {
        const failure = Object.assign(new Error('Forbidden.'), { status: 403 });
        const { dashboard, errors } = createDashboard(t, {
            callTool: (name) => name === failedTool
                ? Promise.reject(failure)
                : { agents: [{ id: 'partial-agent' }], messages: [{ id: 'partial-chat' }], resources: [{ resourceId: 'partial-resource' }] },
        });
        dashboard.refreshMeetingsAfterMissingMeeting = () => assert.fail('Authorization failures must not trigger missing-room recovery.');
        const previousState = structuredClone(dashboard.state);

        await assert.rejects(dashboard.loadMeetingDetails(), (error) => error === failure);

        assert.deepEqual(dashboard.state, previousState);
        assert.deepEqual(errors, []);
    });
}

for (const missing of [true, false]) {
    test(`snapshot ${missing ? 'missing-room' : 'authorization'} failure settles before pending data and consumes later rejection`, async (t) => {
        const data = deferred();
        const failure = new Error(missing ? 'Meeting not found.' : 'Forbidden.');
        const { dashboard } = createDashboard(t, {
            callTool: (name) => name === 'webmeet_room_get' ? Promise.reject(failure) : data.promise,
        });
        let refreshed = false;
        dashboard.refreshMeetingsAfterMissingMeeting = async () => {
            refreshed = true;
            return false;
        };
        let outcome = 'pending';
        const loading = dashboard.loadMeetingDetails().then(
            () => { outcome = 'fulfilled'; },
            (error) => { outcome = error; }
        );
        await new Promise((resolve) => setImmediate(resolve));
        const earlyOutcome = outcome;
        const refreshedBeforeData = refreshed;
        data.reject(new Error('Late data failure.'));
        await loading;
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(earlyOutcome, missing ? 'fulfilled' : failure);
        assert.equal(refreshedBeforeData, missing);
    });
}

test('a guest detail load uses only the scoped guest adapter', async (t) => {
    const { dashboard, calls } = createDashboard(t, { callTool: () => assert.fail('Guest reads must not use authenticated tools.') });
    dashboard.isGuestSession = () => true;
    dashboard.canManageRooms = () => assert.fail('Guest reads must not query administrator capabilities.');
    const guestCalls = [];
    dashboard.fetchPublicMeetingDetails = async (roomId) => {
        guestCalls.push(roomId);
        return { participants: [{ id: 'guest' }], chat: [{ id: 'guest-chat' }], resources: [], agents: [] };
    };

    await dashboard.loadMeetingDetails();

    assert.deepEqual(guestCalls, ['room-a']);
    assert.deepEqual(calls, []);
    assert.deepEqual(dashboard.state.participants, [{ id: 'guest' }]);
    assert.deepEqual(dashboard.state.chat, [{ id: 'guest-chat' }]);
});
