import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export function createOnlyOfficeSessionStore({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const sessions = new Map();

  function prune(now = Date.now()) {
    for (const [token, session] of sessions.entries()) {
      if (!session || session.expiresAt <= now) {
        sessions.delete(token);
      }
    }
  }

  function createSession(value) {
    prune();
    const token = randomUUID();
    sessions.set(token, {
      ...value,
      token,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs
    });
    return token;
  }

  function getSession(token) {
    prune();
    const session = sessions.get(String(token || '')) || null;
    if (!session) {
      return null;
    }
    session.expiresAt = Date.now() + ttlMs;
    return session;
  }

  return {
    createSession,
    getSession,
    prune
  };
}

