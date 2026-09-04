import { callAgentTool, ensureSuccess, parseToolResult } from '/explorer/services/infrastructure/explorerApi.js';

const MONITOR_RETRY_DELAYS_MS = [300, 900, 1_800];

function errorStatus(error) {
    return Number(error?.status || error?.statusCode || error?.response?.status
        || /\bHTTP\s+(\d{3})\b/i.exec(String(error?.message || ''))?.[1]);
}

function historyAccessDenied(error) {
    return [401, 403].includes(errorStatus(error))
        || /not_authenticated|admin_required|forbidden|unauthorized|access.denied/i.test(`${error?.code || ''} ${error?.message || ''}`);
}

export function isTransientHistoryError(error) {
    if (error?.name === 'AbortError' || error?.code === 'tool_error' || historyAccessDenied(error)) return false;
    const status = errorStatus(error);
    if (status) return [502, 503, 504].includes(status);
    return /\borigin_bad_gateway\b/i.test(`${error?.code || ''} ${error?.message || ''}`)
        || (error?.name === 'TypeError' && /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i.test(error.message));
}

export function historyFailureMessage(error) {
    if (historyAccessDenied(error)) return 'History access was denied. Sign in again with an administrator account.';
    if (isTransientHistoryError(error)) return 'The history service is temporarily unavailable. Retry history in a moment.';
    return 'History could not be loaded. Retry history; if it still fails, contact your workspace administrator.';
}

// The shared MCP client cannot cancel its transport. Abandon its result on abort
// and stop all subsequent attempts without leaving an unhandled rejection.
function abortableRequest(request, signal) {
    if (!signal) return request;
    return new Promise((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) abort();
    });
}

function waitForRetry(delay, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
        }, delay);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
}

export async function callDpu(name, args = {}) {
  const result = await callAgentTool('dpuAgent', name, args, { raw: true });
  ensureSuccess(result);
  return parseToolResult(result) || {};
}

export async function callMonitor(name, args = {}, { signal } = {}) {
    for (let attempt = 0; ; attempt += 1) {
        signal?.throwIfAborted();
        try {
            const result = await abortableRequest(callAgentTool('workspaceMonitorAgent', name, args, { raw: true }), signal);
            signal?.throwIfAborted();
            ensureSuccess(result);
            const payload = parseToolResult(result) || {};
            if (payload.ok === false) throw new Error(payload.message || 'Workspace Monitor request failed.');
            return payload;
        } catch (error) {
            signal?.throwIfAborted();
            const message = String(error?.message || error || '');
            const transientGenerationFailure = /browser_csrf_invalid|edge_generation_changed/i.test(message);
            const transientHistoryFailure = name === 'workspace_monitor_history_query' && isTransientHistoryError(error);
            if ((!transientGenerationFailure && !transientHistoryFailure) || attempt >= MONITOR_RETRY_DELAYS_MS.length) throw error;
            if (transientGenerationFailure) window.webSkel?.appServices?.resetClient?.('workspaceMonitorAgent');
            await waitForRetry(MONITOR_RETRY_DELAYS_MS[attempt], signal);
        }
    }
}
