import { callAgentTool, ensureSuccess, parseToolResult } from '/explorer/services/infrastructure/explorerApi.js';

const MAX_SAMPLES = 300;
const MAX_LOG_CHARS = 2 * 1024 * 1024;
const MAX_AUDIT_BYTES = 2 * 1024 * 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 100;
const CHART_INSET = 2;

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

async function callDpu(name, args = {}) {
  const result = await callAgentTool('dpuAgent', name, args, { raw: true });
  ensureSuccess(result);
  return parseToolResult(result) || {};
}

export class WorkspaceMonitorDashboard {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.activeTab = 'overview';
    this.controllers = new Map();
    this.logScrollFrames = new Map();
    this.samples = [];
    this.invalidate();
  }

  beforeRender() {}

  afterRender() {
    this.status = this.element.querySelector('[data-role="status"]');
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
    void this.startResourceStream();
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
    const workspaceCpu = Number(total.cpuPercent);
    const routerCpu = Number(payload.router?.metrics?.cpuPercent);
    const safeWorkspaceCpu = Number.isFinite(workspaceCpu) ? workspaceCpu : 0;
    const safeRouterCpu = Number.isFinite(routerCpu) ? routerCpu : 0;
    const runningCount = runtimes.filter((runtime) => runtime.state?.running).length;
    const unavailableCount = runtimes.filter((runtime) => runtime.state?.running && runtime.metrics?.available === false).length;
    setText(this.element, 'workspace-cpu', `${safeWorkspaceCpu.toFixed(1)}%`);
    setText(this.element, 'router-cpu', `${safeRouterCpu.toFixed(1)}%`);
    setText(this.element, 'workspace-memory', formatBytes(total.memoryBytes));
    setText(this.element, 'runtime-count', String(runtimes.length));
    setText(this.element, 'running-count', String(runningCount));
    setText(this.element, 'unavailable-count', String(unavailableCount));
    const tbody=this.element.querySelector('[data-role="resource-rows"]'); tbody.replaceChildren();
    for(const runtime of runtimes){const row=document.createElement('tr');for(const value of [runtime.agentName||runtime.containerName,runtime.state?.status||'unknown',runtime.metrics?.available===false?'unavailable':`${Number(runtime.metrics?.cpuPercent||0).toFixed(1)}%`,runtime.metrics?.available===false?'unavailable':formatBytes(runtime.metrics?.memoryBytes)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}tbody.append(row);}
    this.samples.push({ workspace: safeWorkspaceCpu, router: safeRouterCpu });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    const workspaceSamples = this.samples.map((sample) => sample.workspace);
    const routerSamples = this.samples.map((sample) => sample.router);
    const scale = Math.max(100, ...workspaceSamples, ...routerSamples);
    const chart = this.element.querySelector('[data-role="resource-chart"]');
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    const title = document.createElementNS(SVG_NAMESPACE, 'title');
    title.textContent = `Workspace CPU ${safeWorkspaceCpu.toFixed(1)}%, Router CPU ${safeRouterCpu.toFixed(1)}%`;
    svg.append(title);
    appendChartSeries(svg, workspaceSamples, scale, 'workspace');
    appendChartSeries(svg, routerSamples, scale, 'router');
    chart.replaceChildren(svg);
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
