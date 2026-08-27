import { callDpu, callMonitor } from './workspace-monitor-api.js';
import { renderHistoryChart } from './workspace-monitor-charts.js';
import { WorkspaceMonitorLogs } from './workspace-monitor-logs.js';
import { WorkspaceMonitorResources } from './workspace-monitor-resources.js';

const DEFAULT_HISTORY_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_POINTS = 50_000;
const RESOURCE_POLL_INTERVAL_MS = 2_000;
const HISTORY_PRESET_DURATIONS_MS = Object.freeze({
  '1h': 60 * 60 * 1000,
  '1d': DEFAULT_HISTORY_DURATION_MS,
  '7d': 7 * DEFAULT_HISTORY_DURATION_MS,
  '1mo': 30 * DEFAULT_HISTORY_DURATION_MS,
  '1y': 365 * DEFAULT_HISTORY_DURATION_MS
});

function setText(root, role, value) {
  const target = root.querySelector(`[data-role="${role}"]`);
  if (target) target.textContent = value;
}

function localDateTimeValue(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function waitForResourcePoll(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    let timer;
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
    timer = setTimeout(done, RESOURCE_POLL_INTERVAL_MS);
  });
}

function requireCurrentSnapshot(payload) {
  if (!payload?.available || !payload.snapshot) throw new Error('No current resource snapshot is available yet.');
  if (payload.stale) throw new Error('The latest resource snapshot is stale.');
  return payload.snapshot;
}

export class WorkspaceMonitorDashboard {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.activeTab = 'overview';
    this.controllers = new Map();
    this.logs = new WorkspaceMonitorLogs(element, {
      callMonitor,
      callDpu,
      setStatus: (message) => this.setStatus(message)
    });
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
    this.logs.initialize();
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
          const scope = role.startsWith('runtime-') ? 'runtime' : 'overview';
          this.setHistoryPresetState(scope, null);
          if (scope === 'runtime') this.handleRuntimeHistoryWindowChange();
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
      this.startResourcePolling();
      void this.loadSelectedRuntimeHistory();
    }
    if (tab === 'router' || tab === 'policy' || tab === 'dpu') void this.logs.start(tab);
  }

  setStatus(message) { if (this.status) this.status.textContent = message; }

  stopStreams() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.logs.stop();
  }

  startOverview() {
    void this.loadOverview();
    void this.loadSettingsAndHistory();
    void this.startResourcePolling();
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
      'router-memory-threshold': this.settings.routerMemoryBytes / 1024 ** 3,
      'log-retention-days': this.settings.logRetentionDays
    };
    for (const [role, value] of Object.entries(values)) {
      const input = this.element.querySelector(`[data-role="${role}"]`);
      if (input) input.value = role === 'log-retention-days'
        ? String(Math.round(Number(value)))
        : Number(value).toFixed(role.includes('memory') ? 2 : 1).replace(/\.00$/, '');
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
    this.setHistoryPresetState('overview', '1d');
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
    this.setHistoryPresetState('runtime', '1d');
  }

  selectHistoryPreset(_target, scope, preset) {
    const duration = HISTORY_PRESET_DURATIONS_MS[preset];
    const runtime = scope === 'runtime';
    if (!duration || (scope !== 'overview' && !runtime)) return;
    const prefix = runtime ? 'runtime-' : '';
    const fromInput = this.element.querySelector(`[data-role="${prefix}history-from"]`);
    const toInput = this.element.querySelector(`[data-role="${prefix}history-to"]`);
    if (!fromInput || !toInput) return;
    const to = new Date();
    fromInput.value = localDateTimeValue(new Date(to.getTime() - duration));
    toInput.value = localDateTimeValue(to);
    this.updateHistoryInputLimits(to);
    this.setHistoryPresetState(scope, preset);
    if (runtime) this.handleRuntimeHistoryWindowChange();
    else this.handleHistoryWindowChange();
  }

  setHistoryPresetState(scope, selectedPreset) {
    this.element.querySelectorAll(`[data-history-preset-scope="${scope}"]`).forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.historyPreset === selectedPreset));
    });
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
      routerMemoryBytes: Math.round(number('router-memory-threshold') * 1024 ** 3),
      logRetentionDays: number('log-retention-days')
    };
    try {
      this.setStatus('Saving Workspace Monitor settings…');
      const payload = await callMonitor('workspace_monitor_settings_update', args);
      this.settings = payload.settings;
      this.renderSettings();
      await this.loadHistory();
      this.setStatus('Workspace Monitor settings saved; log retention applies at the next maintenance cycle');
    } catch (error) {
      this.setStatus(`Settings update failed: ${error.message}`);
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
      const payload = requireCurrentSnapshot(await callMonitor('workspace_monitor_snapshot_get'));
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

  async startResourcePolling() {
    const controller = new AbortController(); this.controllers.set('resources', controller); this.setStatus('Loading live resource usage…');
    while (!controller.signal.aborted) {
      try {
        const payload = requireCurrentSnapshot(await callMonitor('workspace_monitor_snapshot_get'));
        if (!controller.signal.aborted) this.resources.renderSnapshot(payload);
      } catch (error) {
        if (!controller.signal.aborted) this.setStatus(`Resource update unavailable: ${error.message}`);
      }
      await waitForResourcePoll(controller.signal);
    }
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

}
