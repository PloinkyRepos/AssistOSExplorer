const MAX_LOG_CHARS = 2 * 1024 * 1024;
const MAX_AUDIT_BYTES = 2 * 1024 * 1024;
const LOG_POLL_INTERVAL_MS = 2_000;

function formatTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
        ? new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })
        : 'date unavailable';
}

function archivedContent(content) {
    return String(content || '').split('\n').filter(Boolean).map((raw) => {
        try {
            const record = JSON.parse(raw);
            if (typeof record?.line === 'string') return `[${formatTimestamp(record.timestamp)}] ${record.line}`;
        } catch (_) {}
        return raw;
    }).join('\n');
}

function logContent(payload) {
    if (typeof payload?.item?.content !== 'string') throw new Error('Invalid log response.');
    return payload.item.content;
}

function waitForLogPoll(signal) {
    return new Promise((resolve) => {
        if (signal.aborted) { resolve(); return; }
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, LOG_POLL_INTERVAL_MS);
        signal.addEventListener('abort', done, { once: true });
    });
}

export class WorkspaceMonitorLogs {
    constructor(element, { callMonitor, callDpu, setStatus }) {
        this.element = element;
        this.callMonitor = callMonitor;
        this.callDpu = callDpu;
        this.setStatus = setStatus;
        this.controllers = new Map();
        this.scrollFrames = new Map();
        this.views = new Map();
        this.statusElements = new Map();
        this.liveFiles = new Map();
        this.generation = 0;
    }

    initialize() {
        for (const source of ['router', 'policy', 'dpu']) {
            this.element.querySelector(`[data-role="${source}-log-files"]`)?.addEventListener('change', () => void this.loadSelection(source));
            this.element.querySelector(`[data-role="${source}-log-search-button"]`)?.addEventListener('click', () => void this.search(source));
            this.element.querySelector(`[data-role="${source}-log-clear"]`)?.addEventListener('click', () => void this.clearSearch(source));
            this.element.querySelector(`[data-role="${source}-log-reload"]`)?.addEventListener('click', () => void this.start(source));
            this.element.querySelector(`[data-role="${source}-log-search"]`)?.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void this.search(source);
            });
        }
    }

    stop() {
        this.generation += 1;
        for (const controller of this.controllers.values()) controller.abort();
        this.controllers.clear();
        for (const frame of this.scrollFrames.values()) cancelAnimationFrame(frame);
        this.scrollFrames.clear();
        for (const source of this.views.keys()) this.output(source)?.setAttribute('aria-busy', 'false');
    }

    output(source) { return this.element.querySelector(`[data-role="${source}-log"]`); }
    selector(source) { return this.element.querySelector(`[data-role="${source}-log-files"]`); }

    begin(source, key) {
        this.stop();
        if (this.views.get(source)?.key !== key) {
            this.views.set(source, { key, content: '', hasResult: false, failed: false });
        }
        return this.generation;
    }

    showStatus(source, state, message, pending = false) {
        const output = this.output(source);
        if (output) {
            output.dataset.state = state;
            output.setAttribute('aria-busy', String(pending));
            let status = this.statusElements.get(source);
            if (!status) {
                status = document.createElement('p');
                status.className = 'status visible';
                status.dataset.role = `${source}-log-state`;
                status.setAttribute('role', 'status');
                status.setAttribute('aria-live', 'polite');
                output.before(status);
                this.statusElements.set(source, status);
            }
            if (status.textContent !== message) status.textContent = message;
        }
        this.setStatus(message);
    }

    showText(source, text) {
        const output = this.output(source);
        if (output && output.textContent !== text) output.textContent = text;
    }

    showPending(source, message) {
        const view = this.views.get(source);
        if (!view.hasResult && !view.failed) this.showText(source, message);
        const stale = view.failed && view.content ? ' Previously loaded records may be stale.' : '';
        const previous = view.hasResult ? `${stale} Last checked ${view.checkedAt}.` : '';
        this.showStatus(source, view.hasResult ? 'refreshing' : 'loading', `${message}${previous}`, true);
    }

    showResult(source, content, emptyMessage, message) {
        const view = this.views.get(source);
        Object.assign(view, { content, hasResult: true, failed: false, checkedAt: new Date().toLocaleTimeString() });
        this.showText(source, content || emptyMessage);
        this.showStatus(source, content ? 'populated' : 'empty', `${message} Last checked ${view.checkedAt}.`);
    }

    showFailure(source, operation, retrying = false) {
        const view = this.views.get(source);
        view.failed = true;
        const previous = view.content
            ? ` Showing previously loaded records (may be stale); last checked ${view.checkedAt}.`
            : ' No current result is available.';
        const action = retrying ? ' Retrying in 2 seconds.' : ' Use Reload to try again.';
        const message = `${source} ${operation} failed.${previous}${action}`;
        if (!view.content) this.showText(source, message);
        this.showStatus(source, view.content ? 'stale' : 'error', message);
    }

    labelLive(source, empty = false) {
        const live = [...(this.selector(source)?.options || [])].find((option) => option.value === 'live');
        if (live) live.textContent = this.liveFiles.get(source) === false
            ? 'Live (no active file at last reload)'
            : empty ? 'Live (no records)' : 'Live';
    }

    async start(source) {
        const previous = this.selector(source)?.value;
        const generation = this.begin(source, `file:${previous || (source === 'dpu' ? '' : 'live')}`);
        this.showPending(source, `Loading ${source} logs…`);
        try {
            const payload = source === 'dpu'
                ? await this.callDpu('dpu_audit_list')
                : await this.callMonitor('workspace_monitor_logs_list', { source });
            if (generation !== this.generation) return;
            if (!Array.isArray(payload?.items)) throw new Error('Invalid log list response.');
            const items = payload.items;
            const selector = this.selector(source);
            selector?.replaceChildren();
            if (source !== 'dpu') {
                this.liveFiles.set(source, payload.active);
                const live = document.createElement('option');
                live.value = 'live';
                selector?.append(live);
                this.labelLive(source);
            }
            for (const item of items) {
                const option = document.createElement('option');
                option.value = item.name;
                option.textContent = item.name;
                selector?.append(option);
            }
            if (previous && [...(selector?.options || [])].some((option) => option.value === previous)) selector.value = previous;
            await this.loadSelection(source, generation);
        } catch (_) {
            if (generation === this.generation) this.showFailure(source, 'log list');
        }
    }

    async loadSelection(source, generation = this.generation) {
        if (generation !== this.generation) return;
        const name = this.selector(source)?.value || (source === 'dpu' ? '' : 'live');
        generation = this.begin(source, `file:${name}`);
        if (source !== 'dpu' && name === 'live') return this.follow(source, generation);
        if (!name) {
            this.showResult(source, '', 'No log records yet.', `No ${source} log files are available.`);
            return;
        }
        this.showPending(source, `Loading ${source} log file…`);
        try {
            const payload = source === 'dpu'
                ? await this.callDpu('dpu_audit_get', { name, maxBytes: MAX_AUDIT_BYTES })
                : await this.callMonitor('workspace_monitor_logs_get', { source, name, maxBytes: MAX_AUDIT_BYTES });
            if (generation !== this.generation) return;
            const raw = logContent(payload);
            const content = source === 'dpu' ? raw : archivedContent(raw);
            this.showResult(source, content, 'No records in this log file.', `${source} log file loaded; live checking paused.`);
        } catch (_) {
            if (generation === this.generation) this.showFailure(source, 'log file load');
        }
    }

    appendChunk(source, chunk) {
        const output = this.output(source);
        if (!output || !chunk) return;
        let textNode = output.firstChild;
        if (!textNode || textNode.nodeType !== 3) {
            textNode = document.createTextNode('');
            output.replaceChildren(textNode);
        }
        textNode.appendData(chunk);
        if (textNode.length > MAX_LOG_CHARS) {
            const excess = textNode.length - MAX_LOG_CHARS;
            const boundary = textNode.data.indexOf('\n', excess);
            textNode.deleteData(0, boundary === -1 ? excess : boundary + 1);
        }
        if (!this.scrollFrames.has(source)) {
            this.scrollFrames.set(source, requestAnimationFrame(() => {
                this.scrollFrames.delete(source);
                const panel = output.closest('.monitor-panel');
                if (panel) panel.scrollTop = panel.scrollHeight;
            }));
        }
    }

    async follow(source, generation = this.generation) {
        if (generation !== this.generation) return;
        const controller = new AbortController();
        this.controllers.set(source, controller);
        while (!controller.signal.aborted && generation === this.generation) {
            const view = this.views.get(source);
            this.showPending(source, `${view.hasResult ? 'Refreshing' : 'Loading'} ${source} live log…`);
            try {
                const payload = await this.callMonitor('workspace_monitor_logs_get', {
                    source, name: 'live', maxBytes: MAX_AUDIT_BYTES,
                });
                if (controller.signal.aborted || generation !== this.generation) return;
                const content = archivedContent(logContent(payload));
                const changed = content !== view.content;
                if (content) this.liveFiles.set(source, true);
                else if (view.content) this.liveFiles.delete(source);
                this.labelLive(source, !content);
                const empty = source === 'policy'
                    ? 'No policy audit events in the current live log.\nPolicy changes and errors produce audit records; ordinary read-only browsing does not.\nOlder events may be in the archives, including after log rotation.'
                    : 'No records in the current live log. Older records may be in the archives.';
                const status = content
                    ? `Following ${source} live records; refreshing every 2 seconds.`
                    : `No current ${source} live records. Checking for new records every 2 seconds.`;
                this.showResult(source, content, empty, status);
                const output = this.output(source);
                if (changed && content && output) output.scrollTop = output.scrollHeight;
            } catch (_) {
                if (controller.signal.aborted || generation !== this.generation) return;
                this.showFailure(source, 'live log refresh', true);
            }
            await waitForLogPoll(controller.signal);
        }
    }

    async search(source) {
        const query = this.element.querySelector(`[data-role="${source}-log-search"]`)?.value.trim();
        if (!query) return;
        const generation = this.begin(source, `search:${query}`);
        this.showPending(source, `Searching ${source} logs…`);
        try {
            const payload = source === 'dpu'
                ? await this.callDpu('dpu_audit_search', { query, limit: 500 })
                : await this.callMonitor('workspace_monitor_logs_search', { source, query, limit: 500 });
            if (generation !== this.generation) return;
            if (!Array.isArray(payload?.matches)) throw new Error('Invalid log search response.');
            const matches = payload.matches;
            const text = matches.map((match) =>
                `[${formatTimestamp(match.timestamp)}] ${match.file}:${match.lineNumber}\n${match.line}`).join('\n\n');
            this.showResult(source, text, 'No matching log lines.',
                `${matches.length} ${source} log matches${payload.truncated ? ' (newest 500 shown)' : ''}; live checking paused.`);
        } catch (_) {
            if (generation === this.generation) this.showFailure(source, 'log search');
        }
    }

    async clearSearch(source) {
        const input = this.element.querySelector(`[data-role="${source}-log-search"]`);
        if (input) input.value = '';
        await this.loadSelection(source);
    }
}
