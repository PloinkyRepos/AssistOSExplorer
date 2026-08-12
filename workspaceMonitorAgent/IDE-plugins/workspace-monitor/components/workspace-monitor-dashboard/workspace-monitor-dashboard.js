import { callDpu, callMonitor, consumeNdjson } from './workspace-monitor-api.js';
import { renderHistoryChart } from './workspace-monitor-charts.js';
import { WorkspaceMonitorResources } from './workspace-monitor-resources.js';

const MAX_LOG_CHARS = 2 * 1024 * 1024;
const MAX_AUDIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_HISTORY_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_POINTS = 50_000;

function setText(root, role, value) {
  const target = root.querySelector(`[data-role="${role}"]`);
  if (target) target.textContent = value;
}

function localDateTimeValue(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export class WorkspaceMonitorDashboard {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.activeTab = 'overview';
    this.controllers = new Map();
    this.logScrollFrames = new Map();
    this.resources = new WorkspaceMonitorResources(element, {
      onSelectionChange: () => void this.loadSelectedRuntimeHistory(),
      onSelectionCleared: () => this.renderSelectedRuntimeHistoryUnavailable('Select a runtime to load its history.'),
      onLiveUpdate: (date) => this.setStatus(`Live update ${date.toLocaleTimeString()}`)
    });
    this.runtimeHistoryRequestId = 0;
    this.settings = null;
    this.history = null;
    this.invalidate();
  }

  beforeRender() {}

  afterRender() {
    this.status = this.element.querySelector('[data-role="status"]');
    this.initializeHistoryWindow();
    this.initializeRuntimeHistoryWindow();
    for (const role of ['history-from', 'history-to', 'runtime-history-from', 'runtime-history-to']) {
      const input = this.element.querySelector(`[data-role="${role}"]`);
      if (input) {
        const refreshMaximum = () => this.updateHistoryInputLimits();
        input.addEventListener('focus', refreshMaximum);
        input.addEventListener('pointerdown', refreshMaximum);
        input.addEventListener('change', () => {
          this.updateHistoryInputLimits();
          this.clampHistoryInputToPresent(input);
          input.blur();
          if (role.startsWith('runtime-')) this.handleRuntimeHistoryWindowChange();
          else this.handleHistoryWindowChange();
        });
      }
    }
    this.startOverview();
  }

  afterUnload() { this.stopStreams(); }

  selectTab(_target, tab) {
    this.activeTab = tab;
    this.element.querySelectorAll('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    this.element.querySelectorAll('[data-panel]').forEach((panel) => { const active = panel.dataset.panel === tab; panel.hidden = !active; panel.classList.toggle('active', active); });
    this.stopStreams();
    if (tab === 'overview') this.startOverview();
    if (tab === 'resources') {
      this.startResourceStream();
      void this.loadSelectedRuntimeHistory();
    }
    if (tab === 'router' || tab === 'policy') this.startLogStream(tab);
    if (tab === 'dpu') this.reloadAudit();
  }

  setStatus(message) { if (this.status) this.status.textContent = message; }

  stopStreams() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    for (const frame of this.logScrollFrames.values()) cancelAnimationFrame(frame);
    this.logScrollFrames.clear();
  }

  startOverview() {
    void this.loadOverview();
    void this.loadSettingsAndHistory();
    void this.startResourceStream();
  }

  async loadSettingsAndHistory() {
    try {
      const payload = await callMonitor('workspace_monitor_settings_get');
      this.settings = payload.settings;
      this.renderSettings();
      await this.loadHistory();
    } catch (error) {
      this.renderHistoryUnavailable(error.message);
    }
  }

  renderSettings() {
    if (!this.settings) return;
    const values = {
      'workspace-cpu-threshold': this.settings.workspaceCpuPercent,
      'router-cpu-threshold': this.settings.routerCpuPercent,
      'workspace-memory-threshold': this.settings.workspaceMemoryBytes / 1024 ** 3,
      'router-memory-threshold': this.settings.routerMemoryBytes / 1024 ** 3
    };
    for (const [role, value] of Object.entries(values)) {
      const input = this.element.querySelector(`[data-role="${role}"]`);
      if (input) input.value = Number(value).toFixed(role.includes('memory') ? 2 : 1).replace(/\.00$/, '');
    }
  }

  historyWindow() {
    const from = this.element.querySelector('[data-role="history-from"]')?.value;
    const to = this.element.querySelector('[data-role="history-to"]')?.value;
    return { from: new Date(from), to: new Date(to) };
  }

  updateHistoryInputLimits(now = new Date()) {
    const maximum = localDateTimeValue(now);
    for (const role of ['history-from', 'history-to', 'runtime-history-from', 'runtime-history-to']) {
      const input = this.element.querySelector(`[data-role="${role}"]`);
      if (input) input.max = maximum;
    }
  }

  clampHistoryInputToPresent(input, now = new Date()) {
    const selectedTime = new Date(input?.value || '').getTime();
    if (!input || !Number.isFinite(selectedTime) || selectedTime <= now.getTime()) return;
    input.value = localDateTimeValue(now);
  }

  initializeHistoryWindow() {
    const fromInput = this.element.querySelector('[data-role="history-from"]');
    const toInput = this.element.querySelector('[data-role="history-to"]');
    const to = new Date();
    this.updateHistoryInputLimits(to);
    if (!fromInput || !toInput || fromInput.value || toInput.value) return;
    const from = new Date(to.getTime() - DEFAULT_HISTORY_DURATION_MS);
    fromInput.value = localDateTimeValue(from);
    toInput.value = localDateTimeValue(to);
  }

  runtimeHistoryWindow() {
    const from = this.element.querySelector('[data-role="runtime-history-from"]')?.value;
    const to = this.element.querySelector('[data-role="runtime-history-to"]')?.value;
    return { from: new Date(from), to: new Date(to) };
  }

  initializeRuntimeHistoryWindow() {
    const fromInput = this.element.querySelector('[data-role="runtime-history-from"]');
    const toInput = this.element.querySelector('[data-role="runtime-history-to"]');
    const to = new Date();
    this.updateHistoryInputLimits(to);
    if (!fromInput || !toInput || fromInput.value || toInput.value) return;
    fromInput.value = localDateTimeValue(new Date(to.getTime() - DEFAULT_HISTORY_DURATION_MS));
    toInput.value = localDateTimeValue(to);
  }

  handleRuntimeHistoryWindowChange() {
    const { from, to } = this.runtimeHistoryWindow();
    const now = Date.now();
    if (!Number.isFinite(from?.getTime()) || !Number.isFinite(to?.getTime()) || to <= from || from > now || to > now) {
      setText(this.element, 'runtime-history-state', 'Choose a valid history interval that does not extend into the future.');
      return;
    }
    void this.loadSelectedRuntimeHistory();
  }

  handleHistoryWindowChange() {
    const { from, to } = this.historyWindow();
    const now = Date.now();
    if (!Number.isFinite(from?.getTime()) || !Number.isFinite(to?.getTime()) || to <= from || from > now || to > now) {
      setText(this.element, 'history-state', 'Choose a valid history interval that does not extend into the future.');
      return;
    }
    void this.loadHistory();
  }

  async saveThresholds() {
    const number = (role) => Number(this.element.querySelector(`[data-role="${role}"]`)?.value);
    const args = {
      workspaceCpuPercent: number('workspace-cpu-threshold'),
      routerCpuPercent: number('router-cpu-threshold'),
      workspaceMemoryBytes: Math.round(number('workspace-memory-threshold') * 1024 ** 3),
      routerMemoryBytes: Math.round(number('router-memory-threshold') * 1024 ** 3)
    };
    try {
      this.setStatus('Saving resource thresholds…');
      const payload = await callMonitor('workspace_monitor_settings_update', args);
      this.settings = payload.settings;
      this.renderSettings();
      await this.loadHistory();
      this.setStatus('Resource thresholds saved');
    } catch (error) {
      this.setStatus(`Threshold update failed: ${error.message}`);
    }
  }

  async loadHistory() {
    const { from, to } = this.historyWindow();
    const now = Date.now();
    if (!Number.isFinite(from?.getTime()) || !Number.isFinite(to?.getTime()) || to <= from || from > now || to > now) {
      this.renderHistoryUnavailable('Choose a valid history interval that does not extend into the future.');
      return;
    }
    try {
      setText(this.element, 'history-state', 'Loading history…');
      const requestedPoints = Math.min(MAX_HISTORY_POINTS, Math.ceil((to - from) / 60_000) + 1);
      this.history = await callMonitor('workspace_monitor_history_query', {
        from: from.toISOString(), to: to.toISOString(), maxPoints: requestedPoints
      });
      this.renderHistoryCharts();
    } catch (error) {
      this.renderHistoryUnavailable(error.message);
    }
  }

  renderHistoryUnavailable(message) {
    setText(this.element, 'history-state', `History unavailable: ${message}`);
    for (const role of ['cpu-history-chart', 'memory-history-chart']) {
      const host = this.element.querySelector(`[data-role="${role}"]`);
      if (host) {
        host.closest('.history-chart-card')?.querySelector(':scope > .history-y-axis')?.remove();
        host.replaceChildren();
      }
    }
  }

  renderHistoryCharts() {
    const from = Date.parse(this.history.from);
    const to = Date.parse(this.history.to);
    const stepMs = Number(this.history.stepSeconds || 1) * 1000;
    const series = this.history.series || {};
    this.renderHistoryChart('cpu-history-chart', [
      { label: 'Agents', data: series['workspace.cpu'], className: 'history-workspace', threshold: this.settings?.workspaceCpuPercent || 0 },
      { label: 'Router', data: series['router.cpu'], className: 'history-router', threshold: this.settings?.routerCpuPercent || 0 }
    ], { from, to, stepMs, transform: (value) => value, minimumScale: 100, unit: '%' });
    this.renderHistoryChart('memory-history-chart', [
      { label: 'Agents', data: series['workspace.memory'], className: 'history-workspace', threshold: (this.settings?.workspaceMemoryBytes || 0) / 1024 ** 3 },
      { label: 'Router', data: series['router.memory'], className: 'history-router', threshold: (this.settings?.routerMemoryBytes || 0) / 1024 ** 3 }
    ], { from, to, stepMs, transform: (value) => value / 1024 ** 3, minimumScale: 1, unit: ' GiB' });
    const count = Object.values(series).reduce((total, item) => total + (item?.values?.length || 0), 0);
    setText(this.element, 'history-state', count ? `${count} persisted samples` : 'No samples in this interval');
  }

  renderHistoryChart(role, definitions, { from, to, stepMs, transform, minimumScale, unit }) {
    const host = this.element.querySelector(`[data-role="${role}"]`);
    renderHistoryChart(host, definitions, { from, to, stepMs, transform, minimumScale, unit });
  }

  async loadOverview() {
    try {
      const response = await fetch('/status/data', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const runtimes = Array.isArray(payload.runtimes) ? payload.runtimes : [];
      const running = runtimes.filter((entry) => entry.state?.running).length;
      this.renderCards('[data-role="overview"]', [
        ['Workspace', payload.workspace || 'Current workspace'],
        ['Router', payload.router?.status || 'running'],
        ['Runtimes', String(runtimes.length)],
        ['Running', String(running)],
        ['Static agent', payload.static?.agent || '—']
      ]);
      this.setStatus('Overview updated');
    } catch (error) { this.setStatus(`Overview unavailable: ${error.message}`); }
  }

  renderCards(selector, entries) {
    const host = this.element.querySelector(selector); if (!host) return; host.replaceChildren();
    for (const [label, value] of entries) { const card=document.createElement('div');card.className='panel metric-card';const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');v.textContent=value;card.append(l,v);host.append(card); }
  }

  async startResourceStream() {
    const controller = new AbortController(); this.controllers.set('resources', controller); this.setStatus('Streaming live resource usage…');
    try {
      const response = await fetch('/status/data?follow=1', { credentials:'include', cache:'no-store', signal:controller.signal });
      await consumeNdjson(response, (payload) => this.resources.renderSnapshot(payload));
    } catch (error) { if (error.name !== 'AbortError') this.setStatus(`Resource stream stopped: ${error.message}`); }
  }

  async loadSelectedRuntimeHistory() {
    const entry = this.resources.selectedEntry();
    if (!entry) {
      this.renderSelectedRuntimeHistoryUnavailable('Select a runtime to load its history.');
      return;
    }
    const { from, to } = this.runtimeHistoryWindow();
    const now = Date.now();
    if (!Number.isFinite(from?.getTime()) || !Number.isFinite(to?.getTime()) || to <= from || from > now || to > now) {
      setText(this.element, 'runtime-history-state', 'Choose a valid history interval that does not extend into the future.');
      return;
    }
    const requestId = ++this.runtimeHistoryRequestId;
    const cpuKey = `runtime:${entry.key}:cpu`;
    const memoryKey = `runtime:${entry.key}:memory`;
    try {
      setText(this.element, 'runtime-history-state', `Loading ${entry.name} history…`);
      const requestedPoints = Math.min(MAX_HISTORY_POINTS, Math.ceil((to - from) / 60_000) + 1);
      const history = await callMonitor('workspace_monitor_history_query', {
        from: from.toISOString(),
        to: to.toISOString(),
        maxPoints: requestedPoints,
        series: [cpuKey, memoryKey]
      });
      if (requestId !== this.runtimeHistoryRequestId || entry.key !== this.resources.selectedKey) return;
      this.renderSelectedRuntimeHistory(entry, history, cpuKey, memoryKey);
    } catch (error) {
      if (requestId !== this.runtimeHistoryRequestId) return;
      this.renderSelectedRuntimeHistoryUnavailable(error.message);
    }
  }

  renderSelectedRuntimeHistory(entry, history, cpuKey, memoryKey) {
    const from = Date.parse(history.from);
    const to = Date.parse(history.to);
    const stepMs = Number(history.stepSeconds || 1) * 1000;
    const series = history.series || {};
    this.renderHistoryChart('selected-runtime-cpu-history-chart', [
      { label: entry.name, data: series[cpuKey], className: 'history-workspace', showThreshold: false }
    ], { from, to, stepMs, transform: (value) => value, minimumScale: 100, unit: '%' });
    this.renderHistoryChart('selected-runtime-memory-history-chart', [
      { label: entry.name, data: series[memoryKey], className: 'history-workspace', showThreshold: false }
    ], { from, to, stepMs, transform: (value) => value / 1024 ** 3, minimumScale: 1, unit: ' GiB' });
    const count = (series[cpuKey]?.values?.length || 0) + (series[memoryKey]?.values?.length || 0);
    setText(this.element, 'runtime-history-state', count
      ? `${entry.name}: ${count} persisted samples`
      : `${entry.name}: no persisted samples in this interval`);
  }

  renderSelectedRuntimeHistoryUnavailable(message) {
    setText(this.element, 'runtime-history-state', `History unavailable: ${message}`);
    for (const role of ['selected-runtime-cpu-history-chart', 'selected-runtime-memory-history-chart']) {
      const host = this.element.querySelector(`[data-role="${role}"]`);
      if (host) {
        host.closest('.history-chart-card')?.querySelector(':scope > .history-y-axis')?.remove();
        host.replaceChildren();
      }
    }
  }

  appendLogChunk(source, output, chunk) {
    if (!chunk) return;
    let textNode = output.firstChild;
    if (!textNode || textNode.nodeType !== 3) {
      textNode = document.createTextNode('');
      output.replaceChildren(textNode);
    }
    textNode.appendData(chunk);
    if (textNode.length > MAX_LOG_CHARS) {
      const excess = textNode.length - MAX_LOG_CHARS;
      const lineBoundary = textNode.data.indexOf('\n', excess);
      textNode.deleteData(0, lineBoundary === -1 ? excess : lineBoundary + 1);
    }
    if (!this.logScrollFrames.has(source)) {
      const frame = requestAnimationFrame(() => {
        this.logScrollFrames.delete(source);
        const panel = output.closest('.monitor-panel');
        if (panel) panel.scrollTop = panel.scrollHeight;
      });
      this.logScrollFrames.set(source, frame);
    }
  }

  async startLogStream(source) {
    const controller = new AbortController();
    this.controllers.set(source, controller);
    const output = this.element.querySelector(`[data-role="${source}-log"]`);
    output.replaceChildren(document.createTextNode(''));
    this.setStatus(`Following ${source} log…`);
    try {
      const response = await fetch(`/dashboard/tail?source=${encodeURIComponent(source)}&lines=200&follow=1`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (value) this.appendLogChunk(source, output, decoder.decode(value, { stream: true }));
        if (done) {
          this.appendLogChunk(source, output, decoder.decode());
          break;
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') this.setStatus(`Log stream stopped: ${error.message}`);
    }
  }

  async reloadAudit() {
    try{this.setStatus('Loading DPU audit…');const listed=await callDpu('dpu_audit_list');const files=Array.isArray(listed.items)?listed.items:[];const select=this.element.querySelector('[data-role="audit-files"]');const previous=select.value;select.replaceChildren();for(const file of files){const option=document.createElement('option');option.value=file.name;option.textContent=file.name;select.append(option);}if(previous&&files.some((f)=>f.name===previous))select.value=previous;select.onchange=()=>this.loadAuditFile(select.value);await this.loadAuditFile(select.value);this.setStatus('DPU audit updated');}catch(error){this.setStatus(`DPU audit unavailable: ${error.message}`);}
  }

  async loadAuditFile(name) { const output=this.element.querySelector('[data-role="dpu-log"]');if(!name){output.textContent='No audit records yet.';return;}const payload=await callDpu('dpu_audit_get',{name,maxBytes:MAX_AUDIT_BYTES});output.textContent=payload.item?.content||''; }
}
