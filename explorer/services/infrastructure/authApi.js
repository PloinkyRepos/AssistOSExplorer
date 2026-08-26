function normalizeAuthenticatedUser(user) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
        return null;
    }
    const normalized = {};
    for (const field of ['id', 'userId', 'principalId', 'username', 'name', 'displayName', 'email', 'imageId']) {
        const value = String(user[field] || '').trim();
        if (value) {
            normalized[field] = value;
        }
    }
    if (Array.isArray(user.roles)) {
        normalized.roles = user.roles
            .map((role) => String(role || '').trim())
            .filter(Boolean);
    }
    return Object.keys(normalized).length ? normalized : null;
}

export async function fetchAuthenticatedUser() {
    if (typeof fetch !== 'function') {
        return null;
    }
    try {
        const response = await fetch('/auth/token', {
            cache: 'no-store',
            credentials: 'include'
        });
        if (!response.ok) {
            return null;
        }
        const payload = await response.json().catch(() => null);
        return normalizeAuthenticatedUser(payload?.user);
    } catch {
        return null;
    }
}

export async function probeAuthenticatedSession(fetchImplementation = globalThis.fetch) {
    if (typeof fetchImplementation !== 'function') {
        return null;
    }
    try {
        const response = await fetchImplementation('/auth/token', {
            cache: 'no-store',
            credentials: 'include'
        });
        if (response.status === 401) {
            return false;
        }
        if (!response.ok) {
            return null;
        }
        const payload = await response.json().catch(() => null);
        return payload?.ok === true ? true : null;
    } catch {
        return null;
    }
}

export async function fetchAdminControlProof({
    fetchImplementation = globalThis.fetch,
    expectedOrigin = globalThis.location?.origin
} = {}) {
    if (typeof fetchImplementation !== 'function') {
        throw new Error('Local administration is unavailable.');
    }

    const response = await fetchImplementation('/auth/token', {
        cache: 'no-store',
        credentials: 'include',
        headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.message || payload?.error || `Authentication request failed (${response.status})`);
    }

    const origin = String(expectedOrigin || '').trim();
    const proofOrigin = String(payload?.adminControl?.origin || '').trim();
    const csrfToken = String(payload?.adminControl?.csrfToken || '').trim();
    if (!origin || proofOrigin !== origin || !csrfToken) {
        throw new Error('Local administration is unavailable for this origin.');
    }

    return { origin: proofOrigin, csrfToken };
}
