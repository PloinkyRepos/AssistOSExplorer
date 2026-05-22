import { fileURLToPath } from 'node:url';

import * as livekitAgents from '@livekit/agents';
import { AudioStream, RoomEvent, TrackKind, TrackSource } from '@livekit/rtc-node';
import {
    WEBMEET_EVENT_TYPES,
    buildWebMeetEvent,
    parseWebMeetEvent
} from '../../webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/services/webmeet-events.js';

const AGENT_NAME = String(process.env.WEBMEET_LIVEKIT_AGENT_NAME || 'webmeet-agent').trim() || 'webmeet-agent';
const DISPLAY_NAME = String(process.env.WEBMEET_AGENT_NAME || 'WebMeetAgent').trim() || 'WebMeetAgent';
const API_PORT = Number.parseInt(process.env.WEBMEET_API_PORT || '8791', 10);
const API_BASE_URL = String(process.env.WEBMEET_AGENT_API_URL || `http://webmeetAgent:${API_PORT}`).replace(/\/+$/g, '');
const STT_URL = String(process.env.WEBMEET_STT_URL || '').trim();
const INTERNAL_TOKEN = String(process.env.WEBMEET_AGENT_INTERNAL_TOKEN || '').trim();
const SCRIBE_CHUNK_SECONDS = Math.max(3, Number.parseInt(process.env.WEBMEET_SCRIBE_CHUNK_SECONDS || '8', 10) || 8);
const SCRIBE_SAMPLE_RATE = 16_000;
const SCRIBE_CHANNELS = 1;
function normalizeLiveKitWsUrl(value) {
    const raw = String(value || '').trim().replace(/\/+$/g, '');
    if (!raw) return '';
    if (raw.startsWith('https://')) return `wss://${raw.slice(8)}`;
    if (raw.startsWith('http://')) return `ws://${raw.slice(7)}`;
    return raw;
}

const workerLiveKitUrl = process.env.WEBMEET_LIVEKIT_AGENT_URL || process.env.WEBMEET_LIVEKIT_URL;
if (!process.env.LIVEKIT_URL && workerLiveKitUrl) {
    process.env.LIVEKIT_URL = normalizeLiveKitWsUrl(workerLiveKitUrl);
}
if (!process.env.LIVEKIT_API_KEY && process.env.WEBMEET_LIVEKIT_API_KEY) {
    process.env.LIVEKIT_API_KEY = process.env.WEBMEET_LIVEKIT_API_KEY;
}
if (!process.env.LIVEKIT_API_SECRET && process.env.WEBMEET_LIVEKIT_API_SECRET) {
    process.env.LIVEKIT_API_SECRET = process.env.WEBMEET_LIVEKIT_API_SECRET;
}

function safeParseJson(text) {
    try {
        return JSON.parse(String(text || ''));
    } catch {
        return null;
    }
}

function getJobMetadata(ctx) {
    return safeParseJson(ctx?.job?.metadata || ctx?.info?.job?.metadata || ctx?.info?.acceptArguments?.metadata || '') || {};
}

async function getDefaultLlmAgent() {
    const module = await import('achillesAgentLib/LLMAgents').catch(() => null);
    if (!module) return null;
    return (typeof module.getDefaultLLMAgent === 'function' && module.getDefaultLLMAgent())
        || (typeof module.registerDefaultLLMAgent === 'function' && module.registerDefaultLLMAgent())
        || null;
}

async function generateMentionReply({ meetingId, userMessage }) {
    const llmAgent = await getDefaultLlmAgent();
    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        throw new Error('WebMeet AI provider is not configured.');
    }
    const prompt = [
        `You are ${DISPLAY_NAME}, a self-hosted LiveKit participant in a WebMeet room.`,
        'Answer only the direct user request.',
        'Keep the response concise and factual.',
        'Do not invent meeting decisions, tasks, recordings, or participants.',
        '',
        `Meeting id: ${meetingId}`,
        `User request: ${userMessage}`,
        '',
        'Return plain text only.'
    ].join('\n');
    const raw = await llmAgent.executePrompt(prompt, { mode: 'fast', responseShape: 'text' });
    return String(raw || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/g, '').trim();
}

async function persistAgentChat({ meetingId, authorId, message }) {
    const response = await fetch(`${API_BASE_URL}/api/meetings/${encodeURIComponent(meetingId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            authorId,
            authorName: DISPLAY_NAME,
            message
        })
    });
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }
    if (!response.ok) {
        throw new Error(parsed?.error || text || `Failed to persist agent chat: ${response.status}`);
    }
    return parsed?.message || {
        authorId,
        authorName: DISPLAY_NAME,
        message,
        kind: 'agent',
        createdAt: new Date().toISOString()
    };
}

function isAudioTrack(track) {
    return track?.kind === TrackKind.KIND_AUDIO
        || String(track?.kind || '').toLowerCase().includes('audio');
}

function isMicrophonePublication(publication) {
    return publication?.source === TrackSource.SOURCE_MICROPHONE
        || String(publication?.source || '').toLowerCase().includes('microphone');
}

function isAudioPublication(publication) {
    return publication?.kind === TrackKind.KIND_AUDIO
        || isAudioTrack(publication?.track)
        || String(publication?.kind || '').toLowerCase().includes('audio');
}

function getParticipantName(participant) {
    return String(participant?.name || participant?.identity || 'Participant').trim() || 'Participant';
}

function int16ToBuffer(data) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function createWavBuffer(chunks, sampleRate = SCRIBE_SAMPLE_RATE, channels = SCRIBE_CHANNELS) {
    const pcm = Buffer.concat(chunks);
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * 2;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(channels * 2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

async function transcribeAudioChunk(wavBuffer, metadata = {}) {
    if (!STT_URL) {
        throw new Error('STT is not configured.');
    }
    const form = new FormData();
    form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'webmeet-scribe.wav');
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');
    for (const [key, value] of Object.entries({
        meetingId: metadata.meetingId,
        participantIdentity: metadata.participantIdentity,
        participantName: metadata.participantName,
        startedAt: metadata.startedAt,
        endedAt: metadata.endedAt
    })) {
        const text = String(value || '').trim();
        if (text) {
            form.append(key, text);
        }
    }
    const response = await fetch(STT_URL, {
        method: 'POST',
        body: form
    });
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }
    if (!response.ok) {
        throw new Error(parsed?.detail || parsed?.error || text || `STT request failed: ${response.status}`);
    }
    return String(parsed?.text || text || '').trim();
}

async function persistTranscriptSegment({ meetingId, speakerId, speakerName, text, startedAt, endedAt }) {
    if (!INTERNAL_TOKEN) {
        throw new Error('WebMeet internal agent token is not configured.');
    }
    const response = await fetch(`${API_BASE_URL}/internal/meetings/${encodeURIComponent(meetingId)}/transcript`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${INTERNAL_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            speakerId,
            speakerName,
            text,
            startedAt,
            endedAt
        })
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Failed to persist transcript: ${response.status}`);
    }
}

function getTrackKey(track, participant, publication = null) {
    return [
        String(participant?.identity || '').trim(),
        String(track?.sid || publication?.trackSid || publication?.sid || '').trim() || 'audio'
    ].join(':');
}

function startScribeTrackPipeline(metadata, track, participant, publication, cleanupTasks, activeTrackKeys) {
    const meetingId = String(metadata.meetingId || '').trim();
    const participantIdentity = String(participant?.identity || '').trim();
    if (!meetingId || !participantIdentity || !isAudioTrack(track)) return;
    const trackKey = getTrackKey(track, participant, publication);
    if (activeTrackKeys.has(trackKey)) return;
    activeTrackKeys.add(trackKey);
    const stream = new AudioStream(track, {
        sampleRate: SCRIBE_SAMPLE_RATE,
        numChannels: SCRIBE_CHANNELS
    });
    let cancelled = false;
    const cleanup = async () => {
        cancelled = true;
        try { await stream.cancel(); } catch (_) {}
    };
    cleanupTasks.add(cleanup);

    void (async () => {
        let chunks = [];
        let samples = 0;
        let startedAt = new Date().toISOString();
        const maxSamples = SCRIBE_SAMPLE_RATE * SCRIBE_CHUNK_SECONDS;
        const flushChunk = async () => {
            if (!chunks.length) return;
            const endedAt = new Date().toISOString();
            const wav = createWavBuffer(chunks);
            chunks = [];
            samples = 0;
            const text = await transcribeAudioChunk(wav, {
                meetingId,
                participantIdentity,
                participantName: getParticipantName(participant),
                startedAt,
                endedAt
            });
            if (text) {
                await persistTranscriptSegment({
                    meetingId,
                    speakerId: participantIdentity,
                    speakerName: getParticipantName(participant),
                    text,
                    startedAt,
                    endedAt
                });
            }
            startedAt = new Date().toISOString();
        };
        try {
            for await (const frame of stream) {
                if (cancelled) break;
                if (!frame?.data?.length) continue;
                chunks.push(int16ToBuffer(frame.data));
                samples += Number(frame.samplesPerChannel || (frame.data.length / Math.max(1, frame.channels || SCRIBE_CHANNELS)));
                if (samples < maxSamples) continue;
                await flushChunk();
            }
            if (!cancelled) {
                await flushChunk();
            }
        } catch (error) {
            console.error('WebMeet scribe pipeline failed:', error instanceof Error ? error.message : String(error));
        } finally {
            activeTrackKeys.delete(trackKey);
            cleanupTasks.delete(cleanup);
            try { await stream.cancel(); } catch (_) {}
        }
    })();
}

function startScribeAgent(ctx, metadata) {
    const room = ctx.room;
    const cleanupTasks = new Set();
    const activeTrackKeys = new Set();
    const ensurePublicationSubscribed = (publication) => {
        if (!isAudioPublication(publication) || !isMicrophonePublication(publication) || typeof publication?.setSubscribed !== 'function') return;
        try {
            const result = publication.setSubscribed(true);
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        } catch (_) {}
    };
    const handleTrackSubscribed = (track, publication, participant) => {
        const localIdentity = String(room?.localParticipant?.identity || '').trim();
        const participantIdentity = String(participant?.identity || '').trim();
        if (participantIdentity && participantIdentity === localIdentity) return;
        startScribeTrackPipeline(metadata, track, participant, publication, cleanupTasks, activeTrackKeys);
    };
    const handleTrackPublished = (publication, participant) => {
        if (!isAudioPublication(publication) || !isMicrophonePublication(publication)) return;
        ensurePublicationSubscribed(publication);
        if (publication?.track) {
            handleTrackSubscribed(publication.track, publication, participant);
        }
    };
    const handleParticipantConnected = (participant) => {
        const publications = participant?.trackPublications?.values?.();
        if (!publications) return;
        for (const publication of publications) {
            handleTrackPublished(publication, participant);
        }
    };
    const syncExistingTracks = () => {
        const participants = room?.remoteParticipants?.values?.();
        if (!participants) return;
        for (const participant of participants) {
            const publications = participant?.trackPublications?.values?.();
            if (!publications) continue;
            for (const publication of publications) {
                handleTrackPublished(publication, participant);
            }
        }
    };
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    const rescanTimer = setInterval(syncExistingTracks, 1000);
    return {
        syncExistingTracks,
        cleanup: async () => {
            try { room.off?.(RoomEvent.TrackSubscribed, handleTrackSubscribed); } catch (_) {}
            try { room.off?.(RoomEvent.TrackPublished, handleTrackPublished); } catch (_) {}
            try { room.off?.(RoomEvent.ParticipantConnected, handleParticipantConnected); } catch (_) {}
            clearInterval(rescanTimer);
            await Promise.allSettled(Array.from(cleanupTasks, (cleanup) => cleanup()));
        }
    };
}

async function publishWebMeetChat(room, meetingId, chatMessage) {
    const payload = new TextEncoder().encode(buildWebMeetEvent(meetingId, WEBMEET_EVENT_TYPES.CHAT_REALTIME, {
        meetingId,
        message: chatMessage
    }));
    const localParticipant = room?.localParticipant;
    if (typeof localParticipant?.publishData === 'function') {
        await localParticipant.publishData(payload, { reliable: true });
    }
}

async function handleChatPayload(ctx, metadata, payload, participant) {
    let event;
    try {
        event = parseWebMeetEvent(new TextDecoder().decode(payload));
    } catch {
        return;
    }
    if (event.type !== WEBMEET_EVENT_TYPES.CHAT_REALTIME) return;
    const data = event.payload;
    const meetingId = String(metadata.meetingId || data.meetingId || event.room || '').trim();
    if (!meetingId) return;
    if (metadata.mode !== 'on_mention' && metadata.agentType !== 'assistant_on_mention') return;
    const message = String(data.message?.message || '').trim();
    if (!message || !message.includes(`@${DISPLAY_NAME}`)) return;
    const authorIdentity = String(participant?.identity || data.message?.authorId || '').trim();
    if (authorIdentity && authorIdentity === String(ctx.room?.localParticipant?.identity || '').trim()) return;

    let reply = '';
    try {
        reply = await generateMentionReply({ meetingId, userMessage: message });
    } catch (error) {
        reply = error instanceof Error ? error.message : String(error);
    }
    if (!reply) return;
    const authorId = String(ctx.room?.localParticipant?.identity || `${AGENT_NAME}:${meetingId}`).trim();
    const chatMessage = await persistAgentChat({ meetingId, authorId, message: reply });
    await publishWebMeetChat(ctx.room, meetingId, chatMessage);
}

export default livekitAgents.defineAgent({
    entry: async (ctx) => {
        const metadata = getJobMetadata(ctx);
        const room = ctx.room;
        room.on('dataReceived', (payload, participant) => {
            void handleChatPayload(ctx, metadata, payload, participant);
        });
        const scribeController = metadata.agentType === 'scribe'
            ? startScribeAgent(ctx, metadata)
            : null;
        await ctx.connect();
        scribeController?.syncExistingTracks();
        if (typeof room.localParticipant?.setAttributes === 'function') {
            await room.localParticipant.setAttributes({
                webmeetAgent: 'true',
                agentType: String(metadata.agentType || ''),
                mode: String(metadata.mode || '')
            });
        }
        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            room.once('disconnected', finish);
            if (typeof ctx.addShutdownCallback === 'function') {
                ctx.addShutdownCallback(async () => finish());
            }
        });
        await scribeController?.cleanup?.();
    }
});

const Options = livekitAgents.ServerOptions || livekitAgents.WorkerOptions;
const serverOptions = new Options({
    agent: fileURLToPath(import.meta.url),
    agentName: AGENT_NAME,
    logLevel: String(process.env.WEBMEET_LIVEKIT_AGENT_LOG_LEVEL || 'info'),
    requestFunc: async (request) => {
        const metadata = safeParseJson(request?.job?.metadata || '') || {};
        const identity = `${AGENT_NAME}-${request.id}`;
        await request.accept(DISPLAY_NAME, identity, JSON.stringify({
            webmeetAgent: 'true',
            meetingId: String(metadata.meetingId || ''),
            agentType: String(metadata.agentType || ''),
            mode: String(metadata.mode || '')
        }), {
            webmeetAgent: 'true',
            webmeetAgentName: AGENT_NAME,
            webmeetMeetingId: String(metadata.meetingId || ''),
            webmeetAgentType: String(metadata.agentType || ''),
            webmeetAgentMode: String(metadata.mode || '')
        });
    }
});

if (process.argv.length < 3) {
    process.argv.push('start');
}

livekitAgents.cli.runApp(serverOptions);
