const MAX_LOG_CHARS = 2 * 1024 * 1024;
const MAX_AUDIT_BYTES = 2 * 1024 * 1024;

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

export class WorkspaceMonitorLogs {
  constructor(element, { callMonitor, callDpu, setStatus }) {
    this.element = element;
    this.callMonitor = callMonitor;
    this.callDpu = callDpu;
    this.setStatus = setStatus;
    this.controllers = new Map();
    this.scrollFrames = new Map();
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
  }

  output(source) { return this.element.querySelector(`[data-role="${source}-log"]`); }
  selector(source) { return this.element.querySelector(`[data-role="${source}-log-files"]`); }

  async start(source) {
    this.stop();
    const generation = this.generation;
    try {
      this.setStatus(`Loading ${source} logs…`);
      const payload = source === 'dpu'
        ? await this.callDpu('dpu_audit_list')
        : await this.callMonitor('workspace_monitor_logs_list', { source });
      if (generation !== this.generation) return;
      const items = Array.isArray(payload.items) ? payload.items : [];
      const selector = this.selector(source);
      const previous = selector?.value;
      selector?.replaceChildren();
      if (source !== 'dpu') {
        const live = document.createElement('option');
        live.value = 'live';
        live.textContent = 'Live';
        selector?.append(live);
      }
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.name;
        option.textContent = item.name;
        selector?.append(option);
      }
      if (previous && [...(selector?.options || [])].some((option) => option.value === previous)) selector.value = previous;
      await this.loadSelection(source, generation);
    } catch (error) {
      if (generation === this.generation) this.setStatus(`${source} logs unavailable: ${error.message}`);
    }
  }

  async loadSelection(source, generation = this.generation) {
    if (generation !== this.generation) return;
    this.controllers.get(source)?.abort();
    this.controllers.delete(source);
    const name = this.selector(source)?.value;
    if (source !== 'dpu' && (!name || name === 'live')) return this.follow(source, generation);
    const output = this.output(source);
    if (!name) {
      if (output) output.textContent = 'No log records yet.';
      return;
    }
    try {
      const payload = source === 'dpu'
        ? await this.callDpu('dpu_audit_get', { name, maxBytes: MAX_AUDIT_BYTES })
        : await this.callMonitor('workspace_monitor_logs_get', { source, name, maxBytes: MAX_AUDIT_BYTES });
      if (generation !== this.generation) return;
      if (output) output.textContent = source === 'dpu' ? payload.item?.content || '' : archivedContent(payload.item?.content);
      this.setStatus(`${source} log file loaded`);
    } catch (error) {
      if (generation === this.generation) this.setStatus(`${source} log file unavailable: ${error.message}`);
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
    this.output(source)?.replaceChildren(document.createTextNode(''));
    this.setStatus(`Following active ${source} log…`);
    while (!controller.signal.aborted && generation === this.generation) {
      try {
        const payload = await this.callMonitor('workspace_monitor_logs_get', {
          source, name: 'live', maxBytes: MAX_AUDIT_BYTES
        });
        if (controller.signal.aborted || generation !== this.generation) return;
        const output = this.output(source);
        if (output) {
          output.textContent = payload.item?.content ? archivedContent(payload.item.content) : 'Waiting for live log records…';
          output.scrollTop = output.scrollHeight;
        }
      } catch (error) {
        if (!controller.signal.aborted && generation === this.generation) this.setStatus(`${source} live log refresh failed: ${error.message}`);
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  }

  async search(source) {
    const generation = this.generation;
    const query = this.element.querySelector(`[data-role="${source}-log-search"]`)?.value.trim();
    if (!query) return;
    this.controllers.get(source)?.abort();
    this.controllers.delete(source);
    try {
      this.setStatus(`Searching ${source} logs…`);
      const payload = source === 'dpu'
        ? await this.callDpu('dpu_audit_search', { query, limit: 500 })
        : await this.callMonitor('workspace_monitor_logs_search', { source, query, limit: 500 });
      if (generation !== this.generation) return;
      const matches = Array.isArray(payload.matches) ? payload.matches : [];
      const text = matches.length ? matches.map((match) =>
        `[${formatTimestamp(match.timestamp)}] ${match.file}:${match.lineNumber}\n${match.line}`).join('\n\n') : 'No matching log lines.';
      const output = this.output(source);
      if (output) output.textContent = text;
      this.setStatus(`${matches.length} ${source} log matches${payload.truncated ? ' (newest 500 shown)' : ''}`);
    } catch (error) {
      if (generation === this.generation) this.setStatus(`${source} log search failed: ${error.message}`);
    }
  }

  async clearSearch(source) {
    const input = this.element.querySelector(`[data-role="${source}-log-search"]`);
    if (input) input.value = '';
    await this.loadSelection(source);
  }
}
