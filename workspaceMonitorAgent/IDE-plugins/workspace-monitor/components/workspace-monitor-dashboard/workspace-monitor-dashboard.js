import { callAgentTool, ensureSuccess, parseToolResult } from '/explorer/services/infrastructure/explorerApi.js';

const MAX_SAMPLES = 300;
const MAX_LOG_CHARS = 2 * 1024 * 1024;
const MAX_AUDIT_BYTES = 2 * 1024 * 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 100;
const CHART_INSET = 2;
const DEFAULT_HISTORY_DURATION_MS = 24 * 60 * 60 * 1000;
const HISTORY_PIXELS_PER_MINUTE = 8;
const MAX_HISTORY_CHART_WIDTH = 250_000;
const MAX_HISTORY_POINTS = 50_000;
const MONITOR_RETRY_DELAYS_MS = [300, 900, 1_800];

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function buildSmoothChartPath(samples, scale) {
  const usableWidth = CHART_WIDTH - (CHART_INSET * 2);
  const usableHeight = CHART_HEIGHT - (CHART_INSET * 2);
  const points = samples.map((sample, index) => ({
    x: CHART_INSET + (samples.length === 1 ? usableWidth : (index / (samples.length - 1)) * usableWidth),
    y: CHART_INSET + ((scale - Math.min(scale, Math.max(0, sample))) / scale) * usableHeight
  }));
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${CHART_INSET} ${points[0].y} L ${CHART_WIDTH - CHART_INSET} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const controlX = (previous.x + current.x) / 2;
    path += ` C ${controlX} ${previous.y}, ${controlX} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

function buildSmoothChartArea(samples, scale) {
  const line = buildSmoothChartPath(samples, scale);
  if (!line) return '';
  return `${line} L ${CHART_WIDTH - CHART_INSET} ${CHART_HEIGHT - CHART_INSET} L ${CHART_INSET} ${CHART_HEIGHT - CHART_INSET} Z`;
}

function setText(root, role, value) {
  const target = root.querySelector(`[data-role="${role}"]`);
  if (target) target.textContent = value;
}

function appendChartSeries(svg, samples, scale, name) {
  const area = document.createElementNS(SVG_NAMESPACE, 'path');
  area.setAttribute('class', `chart-area chart-area-${name}`);
  area.setAttribute('d', buildSmoothChartArea(samples, scale));
  const line = document.createElementNS(SVG_NAMESPACE, 'path');
  line.setAttribute('class', `chart-line chart-line-${name}`);
  line.setAttribute('d', buildSmoothChartPath(samples, scale));
  svg.append(area, line);
}

function formatTimelineLabel(timestamp, duration, includeSeconds = false) {
  const options = duration >= 24 * 60 * 60 * 1000
    ? { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', ...(includeSeconds ? { second: '2-digit' } : {}) };
  return new Date(timestamp).toLocaleString([], options);
}

function appendChartTimeline(host, from, to, { includeSeconds = false, contentWidth = null } = {}) {
  if (!host || !Number.isFinite(from) || !Number.isFinite(to)) return;
  const timeline = document.createElement('div');
  timeline.className = 'chart-timeline';
  timeline.setAttribute('aria-label', 'Chart timeline');
  const duration = Math.max(0, to - from);
  if (Number.isFinite(contentWidth) && contentWidth > CHART_WIDTH && duration > 0) {
    timeline.classList.add('chart-timeline-scrollable');
    timeline.style.width = `${contentWidth}px`;
    const minuteWidth = contentWidth / (duration / 60_000);
    timeline.style.setProperty('--minute-width', `${minuteWidth}px`);
    timeline.style.setProperty('--minute-tick-width', `${Math.min(1, minuteWidth / 3)}px`);
    const labelSteps = [1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440, 2880, 10080];
    const labelStepMinutes = labelSteps.find((minutes) => minutes * minuteWidth >= 110) || labelSteps.at(-1);
    const labelStepMs = labelStepMinutes * 60_000;
    const first = Math.ceil(from / labelStepMs) * labelStepMs;
    for (let timestamp = first; timestamp <= to; timestamp += labelStepMs) {
      const label = document.createElement('time');
      label.dateTime = new Date(timestamp).toISOString();
      label.textContent = formatTimelineLabel(timestamp, duration);
      label.style.left = `${((timestamp - from) / duration) * 100}%`;
      timeline.append(label);
    }
    host.append(timeline);
    return;
  }
  const timestamps = duration === 0 ? [from] : [from, from + duration / 2, to];
  for (const timestamp of timestamps) {
    const label = document.createElement('time');
    label.dateTime = new Date(timestamp).toISOString();
    label.textContent = formatTimelineLabel(timestamp, duration, includeSeconds);
    timeline.append(label);
  }
  host.append(timeline);
}

function appendTimeAxis(svg, width = CHART_WIDTH) {
  const y = CHART_HEIGHT - CHART_INSET;
  const axis = document.createElementNS(SVG_NAMESPACE, 'line');
  axis.setAttribute('class', 'chart-time-axis');
  axis.setAttribute('x1', String(CHART_INSET));
  axis.setAttribute('x2', String(width - CHART_INSET));
  axis.setAttribute('y1', String(y));
  axis.setAttribute('y2', String(y));
  svg.append(axis);
  for (const x of [CHART_INSET, width / 2, width - CHART_INSET]) {
    const tick = document.createElementNS(SVG_NAMESPACE, 'line');
    tick.setAttribute('class', 'chart-time-tick');
    tick.setAttribute('x1', String(x));
    tick.setAttribute('x2', String(x));
    tick.setAttribute('y1', String(y - 4));
    tick.setAttribute('y2', String(y));
    svg.append(tick);
  }
}

async function callDpu(name, args = {}) {
  const result = await callAgentTool('dpuAgent', name, args, { raw: true });
  ensureSuccess(result);
  return parseToolResult(result) || {};
}

async function callMonitor(name, args = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await callAgentTool('workspaceMonitorAgent', name, args, { raw: true });
      ensureSuccess(result);
      const payload = parseToolResult(result) || {};
      if (payload.ok === false) throw new Error(payload.message || 'Workspace Monitor request failed.');
      return payload;
    } catch (error) {
      const message = String(error?.message || error || '');
      const transientGenerationFailure = /browser_csrf_invalid|edge_generation_changed/i.test(message);
      if (!transientGenerationFailure || attempt >= MONITOR_RETRY_DELAYS_MS.length) throw error;
      window.webSkel?.appServices?.resetClient?.('workspaceMonitorAgent');
      await new Promise((resolve) => setTimeout(resolve, MONITOR_RETRY_DELAYS_MS[attempt]));
    }
  }
}

function localDateTimeValue(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function appendHistoryPath(svg, points, scale, range, className, stepMs) {
  if (!points.length || scale <= 0 || range.to <= range.from) return;
  let path = '';
  let previousTimestamp = null;
  for (const [timestamp, rawValue] of points) {
    const value = Number(rawValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
    const x = CHART_INSET + ((timestamp - range.from) / (range.to - range.from)) * (range.width - CHART_INSET * 2);
    const y = CHART_INSET + ((scale - Math.min(scale, Math.max(0, value))) / scale) * (CHART_HEIGHT - CHART_INSET * 2);
    const disconnected = previousTimestamp === null || timestamp - previousTimestamp > stepMs * 1.5;
    path += `${disconnected ? 'M' : 'L'} ${x} ${y} `;
    previousTimestamp = timestamp;
  }
  if (!path) return;
  const element = document.createElementNS(SVG_NAMESPACE, 'path');
  element.setAttribute('class', `history-line ${className}`);
  element.setAttribute('d', path.trim());
  svg.append(element);
}

function historyChartPoints(points, scale, range) {
  return points.flatMap(([timestamp, rawValue]) => {
    const value = Number(rawValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) return [];
    return [{
      x: CHART_INSET + ((timestamp - range.from) / (range.to - range.from)) * (range.width - CHART_INSET * 2),
      y: CHART_INSET + ((scale - Math.min(scale, Math.max(0, value))) / scale) * (CHART_HEIGHT - CHART_INSET * 2)
    }];
  });
}

function buildHistorySmoothPath(points, scale, range) {
  const plotted = historyChartPoints(points, scale, range);
  if (!plotted.length) return { line: '', area: '' };
  if (plotted.length === 1) {
    const { x, y } = plotted[0];
    return { line: `M ${x} ${y}`, area: '' };
  }
  let line = `M ${plotted[0].x} ${plotted[0].y}`;
  for (let index = 1; index < plotted.length; index += 1) {
    const previous = plotted[index - 1];
    const current = plotted[index];
    const controlX = (previous.x + current.x) / 2;
    line += ` C ${controlX} ${previous.y}, ${controlX} ${current.y}, ${current.x} ${current.y}`;
  }
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  return { line, area: `${line} L ${last.x} ${CHART_HEIGHT - CHART_INSET} L ${first.x} ${CHART_HEIGHT - CHART_INSET} Z` };
}

function thresholdAt(thresholds, timestamp, fallback) {
  let value = Number(fallback);
  for (const [thresholdTimestamp, rawThreshold] of thresholds) {
    if (thresholdTimestamp > timestamp) break;
    if (Number.isFinite(rawThreshold)) value = Number(rawThreshold);
  }
  return value;
}

function aboveThresholdSegments(points, thresholds, fallbackThreshold) {
  const valid = points.filter(([timestamp, value]) => Number.isFinite(timestamp) && Number.isFinite(value));
  const segments = [];
  let active = [];
  const crossing = (left, right) => {
    const leftDifference = left[1] - left[2];
    const rightDifference = right[1] - right[2];
    const ratio = leftDifference / (leftDifference - rightDifference);
    return [
      left[0] + (right[0] - left[0]) * ratio,
      left[1] + (right[1] - left[1]) * ratio
    ];
  };
  const compared = valid.map(([timestamp, value]) => [
    timestamp,
    value,
    thresholdAt(thresholds, timestamp, fallbackThreshold)
  ]);
  for (let index = 0; index < compared.length; index += 1) {
    const current = compared[index];
    const previous = compared[index - 1];
    const currentAbove = current[1] > current[2];
    const previousAbove = previous?.[1] > previous?.[2];
    const currentPoint = [current[0], current[1]];
    if (currentAbove && !previousAbove) active = previous ? [crossing(previous, current), currentPoint] : [currentPoint];
    else if (currentAbove) active.push(currentPoint);
    else if (previousAbove) {
      active.push(crossing(previous, current));
      segments.push(active);
      active = [];
    }
  }
  if (active.length) segments.push(active);
  return segments;
}

function appendHistorySeries(svg, points, scale, range, className, thresholds, fallbackThreshold) {
  const paths = buildHistorySmoothPath(points, scale, range);
  if (!paths.line) return;
  if (paths.area) {
    const area = document.createElementNS(SVG_NAMESPACE, 'path');
    area.setAttribute('class', `history-area ${className}`);
    area.setAttribute('d', paths.area);
    svg.append(area);
  }
  const line = document.createElementNS(SVG_NAMESPACE, 'path');
  line.setAttribute('class', `history-line ${className}`);
  line.setAttribute('d', paths.line);
  svg.append(line);
  for (const segment of aboveThresholdSegments(points, thresholds, fallbackThreshold)) {
    const spikePath = buildHistorySmoothPath(segment, scale, range).line;
    if (!spikePath) continue;
    const spike = document.createElementNS(SVG_NAMESPACE, 'path');
    spike.setAttribute('class', `history-spike ${className}`);
    spike.setAttribute('d', spikePath);
    svg.append(spike);
  }
}

function appendRecordedThreshold(svg, thresholds, fallbackThreshold, scale, range, className, stepMs, unit) {
  const points = thresholds.length ? thresholds : [[range.from, fallbackThreshold], [range.to, fallbackThreshold]];
  let path = '';
  let previous = null;
  let previousLabelValue = null;
  const labels = [];
  for (const [timestamp, rawValue] of points) {
    const value = Number(rawValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
    const x = CHART_INSET + ((timestamp - range.from) / (range.to - range.from)) * (range.width - CHART_INSET * 2);
    const y = CHART_INSET + ((scale - Math.min(scale, Math.max(0, value))) / scale) * (CHART_HEIGHT - CHART_INSET * 2);
    const disconnected = !previous || timestamp - previous.timestamp > stepMs * 1.5;
    if (disconnected) path += `M ${x} ${y} `;
    else if (value !== previous.value) path += `L ${x} ${previous.y} L ${x} ${y} `;
    else path += `L ${x} ${y} `;
    if (previousLabelValue === null || value !== previousLabelValue) {
      const label = document.createElementNS(SVG_NAMESPACE, 'text');
      label.setAttribute('class', `history-threshold-label ${className}`);
      label.setAttribute('x', String(x + 4));
      label.setAttribute('y', String(Math.max(10, y - 3)));
      label.textContent = `${value.toFixed(unit === '%' ? 0 : 2)}${unit}`;
      labels.push(label);
      previousLabelValue = value;
    }
    previous = { timestamp, value, y };
  }
  if (!path) return;
  const line = document.createElementNS(SVG_NAMESPACE, 'path');
  line.setAttribute('class', `history-line history-threshold ${className}`);
  line.setAttribute('d', path.trim());
  svg.append(line);
  svg.append(...labels);
}

function appendHistoryYAxis(host, scale, unit) {
  const card = host.closest('.history-chart-card');
  if (!card) return;
  card.querySelector(':scope > .history-y-axis')?.remove();
  const axis = document.createElement('div');
  axis.className = 'history-y-axis';
  axis.setAttribute('aria-label', `Vertical scale, 0 to ${scale}${unit}`);
  for (let index = 0; index <= 4; index += 1) {
    const value = scale * (1 - index / 4);
    const label = document.createElement('span');
    label.style.top = `${index * 25}%`;
    label.textContent = `${value.toFixed(unit === '%' ? 0 : 2)}${unit}`;
    axis.append(label);
  }
  card.insertBefore(axis, host);
}

function appendHistoryPoints(svg, points, thresholds, fallbackThreshold, scale, range, className, label, unit, onSelect) {
  if (!points.length || scale <= 0 || range.to <= range.from) return;
  for (const [timestamp, rawValue] of points) {
    const value = Number(rawValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
    const x = CHART_INSET + ((timestamp - range.from) / (range.to - range.from)) * (range.width - CHART_INSET * 2);
    const y = CHART_INSET + ((scale - Math.min(scale, Math.max(0, value))) / scale) * (CHART_HEIGHT - CHART_INSET * 2);
    const point = document.createElementNS(SVG_NAMESPACE, 'circle');
    const formattedValue = `${value.toFixed(unit === '%' ? 1 : 2)}${unit}`;
    const threshold = thresholdAt(thresholds, timestamp, fallbackThreshold);
    const formattedThreshold = `${threshold.toFixed(unit === '%' ? 1 : 2)}${unit}`;
    const formattedTime = new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
    point.setAttribute('class', `history-point ${className}`);
    point.setAttribute('cx', String(x));
    point.setAttribute('cy', String(y));
    point.setAttribute('r', '4');
    point.setAttribute('tabindex', '0');
    point.setAttribute('role', 'button');
    point.setAttribute('aria-label', `${label}, ${formattedValue}, threshold ${formattedThreshold}, ${formattedTime}`);
    const select = () => onSelect({ label, formattedValue, formattedThreshold, formattedTime, exceeded: value > threshold });
    point.addEventListener('click', select);
    point.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      select();
    });
    svg.append(point);
  }
}

function appendThresholdLine(svg, value, scale, className, width = CHART_WIDTH) {
  if (!Number.isFinite(value) || value < 0 || scale <= 0) return;
  const y = CHART_INSET + ((scale - Math.min(scale, value)) / scale) * (CHART_HEIGHT - CHART_INSET * 2);
  const line = document.createElementNS(SVG_NAMESPACE, 'line');
  line.setAttribute('class', `history-threshold ${className}`);
  line.setAttribute('x1', String(CHART_INSET));
  line.setAttribute('x2', String(width - CHART_INSET));
  line.setAttribute('y1', String(y));
  line.setAttribute('y2', String(y));
  svg.append(line);
}

export class WorkspaceMonitorDashboard {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.activeTab = 'overview';
    this.controllers = new Map();
    this.logScrollFrames = new Map();
    this.samples = [];
    this.settings = null;
    this.history = null;
    this.invalidate();
  }

  beforeRender() {}

  afterRender() {
    this.status = this.element.querySelector('[data-role="status"]');
    this.initializeHistoryWindow();
    for (const role of ['history-from', 'history-to']) {
      const input = this.element.querySelector(`[data-role="${role}"]`);
      if (input) {
        const refreshMaximum = () => this.updateHistoryInputLimits();
        input.addEventListener('focus', refreshMaximum);
        input.addEventListener('pointerdown', refreshMaximum);
        input.addEventListener('change', () => {
          this.updateHistoryInputLimits();
          this.clampHistoryInputToPresent(input);
          input.blur();
          this.handleHistoryWindowChange();
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
    if (tab === 'resources') this.startResourceStream();
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
    for (const role of ['history-from', 'history-to']) {
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
    const transformed = definitions.map((definition) => ({
      ...definition,
      values: (definition.data?.values || []).map(([timestamp, value]) => [timestamp, transform(value)]),
      thresholds: (definition.data?.thresholds || []).map(([timestamp, value]) => [timestamp, transform(value)]),
      valueThresholds: (definition.data?.valueThresholds || []).map(([timestamp, value]) => [timestamp, transform(value)]),
      threshold: Number(definition.threshold)
    }));
    const chartWidth = Math.min(MAX_HISTORY_CHART_WIDTH, Math.max(CHART_WIDTH, Math.ceil((to - from) / 60_000) * HISTORY_PIXELS_PER_MINUTE));
    const range = { from, to, width: chartWidth };
    const scale = Math.max(minimumScale, ...transformed.flatMap((item) => [item.threshold, ...item.values.map(([, value]) => value), ...item.thresholds.map(([, value]) => value), ...item.valueThresholds.map(([, value]) => value)]));
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', `0 0 ${chartWidth} ${CHART_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.style.width = `${chartWidth}px`;
    appendTimeAxis(svg, chartWidth);
    const host = this.element.querySelector(`[data-role="${role}"]`);
    if (!host) return;
    const showPointDetails = ({ label, formattedValue, formattedThreshold, formattedTime, exceeded }) => {
      let details = host.querySelector('.chart-point-details');
      if (!details) {
        details = document.createElement('output');
        details.className = 'chart-point-details';
        details.setAttribute('aria-live', 'polite');
        host.append(details);
      }
      details.style.left = `${host.scrollLeft + 8}px`;
      details.textContent = `${label}: ${formattedValue} · threshold ${formattedThreshold}${exceeded ? ' · spike' : ''} · ${formattedTime}`;
    };
    for (const item of transformed) {
      const comparisonThresholds = item.valueThresholds.length ? item.valueThresholds : item.thresholds;
      appendRecordedThreshold(svg, item.thresholds, item.threshold, scale, range, item.className, stepMs, unit);
      appendHistorySeries(svg, item.values, scale, range, item.className, comparisonThresholds, item.threshold);
      appendHistoryPoints(svg, item.values, comparisonThresholds, item.threshold, scale, range, item.className, item.label, unit, showPointDetails);
    }
    host.replaceChildren(svg);
    appendChartTimeline(host, from, to, { contentWidth: chartWidth });
    appendHistoryYAxis(host, scale, unit);
    const latestTimestamp = Math.max(from, ...transformed.flatMap((item) => item.values.map(([timestamp]) => timestamp)));
    requestAnimationFrame(() => {
      const latestX = ((latestTimestamp - from) / (to - from)) * chartWidth;
      host.scrollLeft = Math.max(0, latestX - host.clientWidth * 0.75);
    });
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

  async consumeNdjson(response, onValue) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer='';
    while (true) { const {value,done}=await reader.read(); buffer+=decoder.decode(value||new Uint8Array(),{stream:!done}); const lines=buffer.split('\n'); buffer=lines.pop()||''; for(const line of lines){if(line.trim()) onValue(JSON.parse(line));} if(done){if(buffer.trim()) onValue(JSON.parse(buffer));break;} }
  }

  async startResourceStream() {
    const controller = new AbortController(); this.controllers.set('resources', controller); this.setStatus('Streaming live resource usage…');
    try {
      const response = await fetch('/status/data?follow=1', { credentials:'include', cache:'no-store', signal:controller.signal });
      await this.consumeNdjson(response, (payload) => this.renderResources(payload));
    } catch (error) { if (error.name !== 'AbortError') this.setStatus(`Resource stream stopped: ${error.message}`); }
  }

  renderResources(payload) {
    const total = payload.total || {}; const runtimes = Array.isArray(payload.runtimes) ? payload.runtimes : [];
    const routerCpu = Number(payload.router?.metrics?.cpuPercent);
    const routerMemory = Number(payload.router?.metrics?.memoryBytes);
    const safeRouterCpu = Number.isFinite(routerCpu) ? routerCpu : 0;
    const safeRouterMemory = Number.isFinite(routerMemory) ? routerMemory : 0;
    const agents = runtimes.reduce((sum, runtime) => ({
      cpuPercent: sum.cpuPercent + (runtime.metrics?.available === false ? 0 : Number(runtime.metrics?.cpuPercent) || 0),
      memoryBytes: sum.memoryBytes + (runtime.metrics?.available === false ? 0 : Number(runtime.metrics?.memoryBytes) || 0)
    }), { cpuPercent: 0, memoryBytes: 0 });
    const safeAgentsCpu = agents.cpuPercent;
    const safeAgentsMemory = agents.memoryBytes;
    const reportedTotalCpu = Number(total.cpuPercent);
    const reportedTotalMemory = Number(total.memoryBytes);
    const totalCpu = Number.isFinite(reportedTotalCpu) ? reportedTotalCpu : safeAgentsCpu + safeRouterCpu;
    const totalMemory = Number.isFinite(reportedTotalMemory) ? reportedTotalMemory : safeAgentsMemory + safeRouterMemory;
    const runningCount = runtimes.filter((runtime) => runtime.state?.running).length;
    const unavailableCount = runtimes.filter((runtime) => runtime.state?.running && runtime.metrics?.available === false).length;
    setText(this.element, 'total-cpu', `${totalCpu.toFixed(1)}%`);
    setText(this.element, 'agents-cpu', `${safeAgentsCpu.toFixed(1)}%`);
    setText(this.element, 'router-cpu', `${safeRouterCpu.toFixed(1)}%`);
    setText(this.element, 'total-memory', formatBytes(totalMemory));
    setText(this.element, 'agents-memory', formatBytes(safeAgentsMemory));
    setText(this.element, 'router-memory', formatBytes(safeRouterMemory));
    setText(this.element, 'runtime-count', String(runtimes.length));
    setText(this.element, 'running-count', String(runningCount));
    setText(this.element, 'unavailable-count', String(unavailableCount));
    const tbody=this.element.querySelector('[data-role="resource-rows"]'); tbody.replaceChildren();
    for(const runtime of runtimes){const row=document.createElement('tr');for(const value of [runtime.agentName||runtime.containerName,runtime.state?.status||'unknown',runtime.metrics?.available===false?'unavailable':`${Number(runtime.metrics?.cpuPercent||0).toFixed(1)}%`,runtime.metrics?.available===false?'unavailable':formatBytes(runtime.metrics?.memoryBytes)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}tbody.append(row);}
    this.samples.push({ timestamp: Date.now(), total: totalCpu, agents: safeAgentsCpu, router: safeRouterCpu });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    const totalSamples = this.samples.map((sample) => sample.total);
    const agentsSamples = this.samples.map((sample) => sample.agents);
    const routerSamples = this.samples.map((sample) => sample.router);
    const scale = Math.max(100, ...totalSamples, ...agentsSamples, ...routerSamples);
    const chart = this.element.querySelector('[data-role="resource-chart"]');
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    appendTimeAxis(svg);
    const title = document.createElementNS(SVG_NAMESPACE, 'title');
    title.textContent = `Total CPU ${totalCpu.toFixed(1)}%, Agents CPU ${safeAgentsCpu.toFixed(1)}%, Router CPU ${safeRouterCpu.toFixed(1)}%`;
    svg.append(title);
    appendChartSeries(svg, totalSamples, scale, 'total');
    appendChartSeries(svg, agentsSamples, scale, 'agents');
    appendChartSeries(svg, routerSamples, scale, 'router');
    chart.replaceChildren(svg);
    appendChartTimeline(chart, this.samples[0].timestamp, this.samples[this.samples.length - 1].timestamp, { includeSeconds: true });
    this.setStatus(`Live update ${new Date().toLocaleTimeString()}`);
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
