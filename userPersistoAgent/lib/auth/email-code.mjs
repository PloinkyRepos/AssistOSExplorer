import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { getStore, flush } from '../store.mjs';
import { getUserByEmail, createUser } from '../users.mjs';
import { recordAudit } from '../audit.mjs';

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(code, challengeId) {
    const key = process.env.USERPERSISTO_SETTINGS_KEY || '';
    if (!key) {
        throw new Error('USERPERSISTO_SETTINGS_KEY is required to hash auth codes.');
    }
    return createHmac('sha256', key).update(`${challengeId}:${code}`).digest('base64url');
}

export async function startEmailCode({ email, purpose = 'login', correlationId = '', createSelfRegistered = false }) {
    const store = await getStore();
    const normalized = String(email || '').trim().toLowerCase();
    const user = await getUserByEmail(normalized);
    if (!user && !createSelfRegistered) {
        await recordAudit({ actorId: 'anonymous', action: 'auth.emailcode.start', target: normalized, result: 'denied', reason: 'unknown_user' });
        return { challengeId: randomUUID(), code: null, user: null };
    }

    const challengeId = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await store.createAuthChallenge({
        challengeId,
        subject: user ? user.id : `email:${normalized}`,
        purpose: createSelfRegistered && !user ? 'self-registration' : String(purpose || 'login'),
        codeHash: hashCode(code, challengeId),
        expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        attempts: 0,
        correlationId: String(correlationId)
    });
    await recordAudit({ actorId: user ? user.id : 'anonymous', action: 'auth.emailcode.start', target: normalized, result: 'ok', reason: correlationId });
    await flush();
    return { challengeId, code, user };
}

export async function verifyEmailCode({ challengeId, code }) {
    const store = await getStore();
    if (!(await store.hasAuthChallenge(challengeId))) {
        return { ok: false, reason: 'challenge_not_found' };
    }
    const challenge = await store.getAuthChallenge(challengeId);
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
        await store.deleteAuthChallenge(challengeId);
        await flush();
        return { ok: false, reason: 'code_expired' };
    }
    if ((challenge.attempts || 0) >= MAX_ATTEMPTS) {
        await store.deleteAuthChallenge(challengeId);
        await flush();
        return { ok: false, reason: 'too_many_attempts' };
    }
    if (hashCode(String(code || ''), challengeId) !== challenge.codeHash) {
        await store.updateAuthChallenge(challenge.id, { attempts: (challenge.attempts || 0) + 1 });
        await flush();
        return { ok: false, reason: 'invalid_code' };
    }

    await store.deleteAuthChallenge(challengeId);
    let user = null;
    if (String(challenge.subject).startsWith('email:')) {
        const email = challenge.subject.slice('email:'.length);
        user = await getUserByEmail(email);
        if (!user && challenge.purpose === 'self-registration') {
            user = await createUser({ email, displayName: email, source: 'self-registration', roles: ['selfRegistered'] });
        }
    } else {
        user = (await store.hasUser(challenge.subject)) ? await store.getUser(challenge.subject) : null;
    }

    if (!user) {
        await flush();
        return { ok: false, reason: 'unknown_user' };
    }
    if (user.status !== 'active') {
        await flush();
        return { ok: false, reason: 'user_blocked' };
    }
    await recordAudit({ actorId: user.id, action: 'auth.emailcode.verify', target: user.id, result: 'ok', reason: challenge.correlationId });
    await flush();
    return { ok: true, user };
}
