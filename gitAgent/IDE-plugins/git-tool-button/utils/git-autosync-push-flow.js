function errorText(error) {
    return String(error?.message || error || '').trim();
}

export function isNonFastForwardPushError(error) {
    const message = errorText(error);
    return /non[- ]fast[- ]forward/i.test(message)
        || /(?:updates were rejected|\[rejected\]).*(?:fetch first|tip of (?:your )?current branch is behind)/is.test(message);
}

export async function pushWithNonFastForwardRetry({ push, synchronize } = {}) {
    if (typeof push !== 'function' || typeof synchronize !== 'function') {
        throw new TypeError('AutoSync push and synchronize functions are required.');
    }

    try {
        await push();
        return { ok: true, retried: false };
    } catch (error) {
        if (!isNonFastForwardPushError(error)) {
            return { ok: false, retried: false, phase: 'push', error };
        }
    }

    try {
        await synchronize();
    } catch (error) {
        return { ok: false, retried: true, phase: 'synchronize', error };
    }

    try {
        await push();
        return { ok: true, retried: true };
    } catch (error) {
        return { ok: false, retried: true, phase: 'retry-push', error };
    }
}
