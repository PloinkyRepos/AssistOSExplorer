export const RUNTIME_STATUS_UPDATED_EVENT = 'ploinky:runtime-status-updated';
const RETRYABLE_RUNTIME_STATUS_HTTP_STATUSES = new Set([502, 503, 504]);

export function isRetryableRuntimeStatusStreamError(error) {
    const status = Number(error?.status);
    return !Number.isFinite(status) || RETRYABLE_RUNTIME_STATUS_HTTP_STATUSES.has(status);
}

export async function publishRuntimeStatusEvents({
    signal,
    eventTarget = window,
    fetchImplementation = globalThis.fetch
} = {}) {
    const response = await fetchImplementation('/status/data?follow=1', {
        credentials: 'include',
        cache: 'no-store',
        signal,
        headers: { Accept: 'application/x-ndjson' }
    });
    if (!response.ok) {
        const error = new Error(`Runtime status stream failed (${response.status})`);
        error.status = response.status;
        throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const {value, done} = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), {stream: !done});
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim()) continue;
            const snapshot = JSON.parse(line);
            eventTarget.dispatchEvent(new CustomEvent(RUNTIME_STATUS_UPDATED_EVENT, {
                detail: snapshot
            }));
        }
        if (done) {
            if (buffer.trim()) {
                eventTarget.dispatchEvent(new CustomEvent(RUNTIME_STATUS_UPDATED_EVENT, {
                    detail: JSON.parse(buffer)
                }));
            }
            return;
        }
    }
}
