import { createAgentClient } from '/MCPBrowserClient.js';

const SOPLANG_MCP = '/mcps/soplangAgent/mcp';
const client = createAgentClient(SOPLANG_MCP);

let warnings = [];
let errors = [];
let variables = [];
let showAllVariables = false;
let buildState = {
  active: false,
  title: 'Idle',
  detail: 'No build running.'
};
let liveTaskLogs = new Map();
let liveTaskOrder = [];
let copyLiveLogsToastTimer = null;

const extractMcpText = (result) => {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .map((item) => {
      if (typeof item?.text === 'string') return item.text;
      if (typeof item?.data === 'string') return item.data;
      return '';
    })
    .filter((text) => text && !text.startsWith('stderr:'))
    .join('\n');
};

async function callTool(name, args = {}, options = {}) {
  const result = await client.callTool(name, args, options);
  const text = extractMcpText(result);
  if (text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }
  return result;
}

function humanizeBuildError(rawValue) {
  const raw = typeof rawValue === 'string'
    ? rawValue
    : (rawValue?.message || String(rawValue || ''));

  const normalized = raw.replace(/\s+/g, ' ').trim();
  const isGateway502 =
    /All model invocations failed:/i.test(normalized)
    && /API Error \(502\)/i.test(normalized);
  const isAxiologicGateway =
    /soul\.axiologic\.dev/i.test(normalized)
    || /axiologic\.dev \| 502/i.test(normalized)
    || /Bad gateway/i.test(normalized);

  if (isGateway502 || isAxiologicGateway) {
    return {
      text: 'The AI service is temporarily unavailable. Please try again in a few minutes.',
      raw
    };
  }

  return {
    text: raw || 'Build execution failed.',
    raw
  };
}

function normalizeBuildErrorEntry(entry) {
  if (entry && typeof entry === 'object' && entry.text && !entry.message && !entry.err) {
    const friendly = humanizeBuildError(entry.text);
    return {
      text: friendly.text,
      raw: friendly.raw,
      err: entry.err || null
    };
  }

  const raw = typeof entry === 'object' && entry?.message
    ? entry.message
    : entry;
  return humanizeBuildError(raw);
}

function renderBuildState() {
  const strip = document.getElementById('build-status-strip');
  const title = document.getElementById('build-status-title');
  const detail = document.getElementById('build-status-detail');
  const spinner = document.getElementById('build-spinner');
  strip.classList.toggle('hidden', !buildState.active);
  strip.classList.toggle('build-error', buildState.error === true);
  spinner.style.display = buildState.error ? 'none' : '';
  title.textContent = buildState.title;
  detail.textContent = buildState.detail;
}

function setBuildState(active, title, detail, error) {
  buildState = {
    active,
    title: title || 'Idle',
    detail: detail || 'No build running.',
    error: error || false
  };
  renderBuildState();
}

function resetLiveLogs() {
  liveTaskLogs = new Map();
  liveTaskOrder = [];
  renderLiveLogs();
}

function renderLiveLogs() {
  const logView = document.getElementById('build-live-log');
  if (!logView) return;

  const shouldStickToBottom = (logView.scrollTop + logView.clientHeight) >= (logView.scrollHeight - 12);

  if (!liveTaskOrder.length) {
    logView.textContent = 'No logs yet.';
    return;
  }

  const sections = [];
  liveTaskOrder.forEach((taskId, index) => {
    const entry = liveTaskLogs.get(taskId);
    if (!entry) return;
    sections.push(`### ${entry.label} (${taskId})`);
    sections.push(entry.tail && entry.tail.trim().length ? entry.tail.trimEnd() : '(No output yet)');
    if (entry.truncated) {
      sections.push('[Older output truncated to keep UI responsive.]');
    }
    if (index < liveTaskOrder.length - 1) {
      sections.push('');
    }
  });

  logView.textContent = sections.join('\n');
  if (shouldStickToBottom) {
    logView.scrollTop = logView.scrollHeight;
  }
}

function updateLiveLogsFromTask(task, label) {
  if (!task || typeof task !== 'object' || !task.id) {
    return;
  }

  if (!liveTaskLogs.has(task.id)) {
    liveTaskOrder.push(task.id);
    liveTaskLogs.set(task.id, {
      label: label || task.toolName || 'Task',
      tail: '',
      truncated: false
    });
  }

  const entry = liveTaskLogs.get(task.id);
  if (label) {
    entry.label = label;
  }
  if (typeof task.logTail === 'string') {
    entry.tail = task.logTail;
  }
  if (task.logTruncated === true) {
    entry.truncated = true;
  }

  renderLiveLogs();
}

function describeTaskUpdate(task, fallbackLabel) {
  const status = typeof task?.status === 'string' ? task.status.toLowerCase() : 'queued';
  if (status === 'queued') {
    return {
      title: `${fallbackLabel} queued`,
      detail: 'Waiting for the worker to start the task.'
    };
  }
  if (status === 'running') {
    return {
      title: `${fallbackLabel} running`,
      detail: 'The build is in progress. This can take a while for long-running skills.'
    };
  }
  if (status === 'completed') {
    return {
      title: `${fallbackLabel} completed`,
      detail: 'Build finished successfully.'
    };
  }
  if (status === 'failed') {
    return {
      title: `${fallbackLabel} failed`,
      detail: task?.error || 'The task failed.'
    };
  }
  return {
    title: `${fallbackLabel} ${status}`,
    detail: 'Task status updated.'
  };
}

function createStatusUpdater(label, runningDetail) {
  return (task) => {
    updateLiveLogsFromTask(task, label);
    const status = typeof task?.status === 'string' ? task.status.toLowerCase() : 'queued';
    if (status === 'running') {
      setBuildState(true, `${label} running`, runningDetail);
      return;
    }
    const statusView = describeTaskUpdate(task, label);
    setBuildState(true, statusView.title, statusView.detail);
  };
}

async function loadVariables() {
  const data = await callTool('get_variables_with_values');
  variables = Array.isArray(data) ? data : [];
  renderVars();
}

function getVisibleVariables() {
  if (showAllVariables) {
    return variables;
  }
  return variables.filter((variable) => variable?.isActive !== false);
}

async function sync_documents() {
  const btn = document.getElementById('sync-documents');
  btn.disabled = true;
  try {
    resetLiveLogs();
    setBuildState(true, 'Sync documents queued', 'Waiting for the sync task to start.');
    const result = await callTool('sync_markdown_documents', {}, {
      onTaskUpdate: createStatusUpdater(
        'Sync documents',
        'Scanning workspace documents and refreshing the SOPLang workspace.'
      )
    });
    warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    errors = Array.isArray(result?.errors) ? result.errors : [];
    setBuildState(true, 'Loading variables', 'Sync finished. Refreshing variables.');
    await loadVariables();
    renderErrors();
    setBuildState(false, 'Idle', 'No build running.');
  } catch (err) {
    const friendlyError = humanizeBuildError(err?.message || 'Build failed');
    errors = [friendlyError];
    renderErrors();
    setBuildState(true, 'Sync failed', friendlyError.text, true);
    await loadVariables();
  } finally {
    btn.disabled = false;
  }
}

async function executeBuild() {
  const btn = document.getElementById('execute-build');
  const syncBtn = document.getElementById('sync-documents');
  btn.disabled = true;
  syncBtn.disabled = true;
  try {
    resetLiveLogs();
    setBuildState(true, 'Sync documents queued', 'Waiting for the sync task to start.');
    const syncResult = await callTool('sync_markdown_documents', {}, {
      onTaskUpdate: createStatusUpdater(
        'Sync documents',
        'Scanning workspace documents and preparing the full build.'
      )
    });
    warnings = Array.isArray(syncResult?.warnings) ? syncResult.warnings : [];

    const buildLabel = 'Full build';

    setBuildState(true, `${buildLabel} queued`, 'Waiting for the build task to start.');
    const buildResult = await callTool('execute_workspace_build', {}, {
      onTaskUpdate(task) {
        updateLiveLogsFromTask(task, buildLabel);
        const statusView = describeTaskUpdate(task, buildLabel);
        setBuildState(true, statusView.title, statusView.detail);
      }
    });

    errors = Array.isArray(buildResult?.errors) ? buildResult.errors : [];
    setBuildState(true, 'Loading variables', 'Build finished. Refreshing variables.');
    await loadVariables();
    renderErrors();
    setBuildState(false, 'Idle', 'No build running.');
  } catch (err) {
    const friendlyError = humanizeBuildError(err?.message || 'Build execution failed');
    errors = [friendlyError];
    renderErrors();
    setBuildState(true, 'Build failed', friendlyError.text, true);
    await loadVariables();
  } finally {
    btn.disabled = false;
    syncBtn.disabled = false;
  }
}

function renderErrors() {
  const body = document.getElementById('errors-body');
  if ((!warnings || !warnings.length) && (!errors || !errors.length)) {
    body.textContent = 'No errors';
    return;
  }
  const lines = [];
  warnings.forEach((w) => lines.push(`<div class="warning-item">${w}</div>`));
  errors.forEach((e) => {
    if (typeof e === 'object' && e.text) {
      const normalized = normalizeBuildErrorEntry(e);
      const title = normalized.raw && normalized.raw !== normalized.text
        ? ` title="${escapeHtml(normalized.raw)}"`
        : '';
      lines.push(`<div class="error-item"${title}>${escapeHtml(normalized.text)}${normalized.err ? ` (${escapeHtml(normalized.err)})` : ''}</div>`);
    } else {
      const raw = typeof e === 'object'
        ? JSON.stringify(e, null, 2)
        : String(e);
      const normalized = normalizeBuildErrorEntry(raw);
      const title = normalized.raw && normalized.raw !== normalized.text
        ? ` title="${escapeHtml(normalized.raw)}"`
        : '';
      lines.push(`<div class="error-item"${title}>${escapeHtml(normalized.text)}</div>`);
    }
  });
  body.innerHTML = lines.join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toValueString(value) {
  if (value === undefined) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }
  return String(value);
}

async function copyTextToClipboard(text) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const temp = document.createElement('textarea');
  temp.value = value;
  temp.setAttribute('readonly', 'readonly');
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  temp.style.left = '-9999px';
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
}

async function handleCopyLiveLogs() {
  const button = document.getElementById('copy-live-logs');
  const logView = document.getElementById('build-live-log');
  if (!button || !logView) {
    return;
  }

  const text = logView.textContent || '';

  try {
    await copyTextToClipboard(text);
    showCopyLiveLogsToast('Copied!');
  } catch (_) {
    showCopyLiveLogsToast('Copy failed');
  }
}

function showCopyLiveLogsToast(message) {
  const toast = document.getElementById('copy-live-logs-toast');
  if (!toast) {
    return;
  }

  toast.textContent = message || 'Copied!';
  toast.classList.add('visible');

  if (copyLiveLogsToastTimer) {
    clearTimeout(copyLiveLogsToastTimer);
  }

  copyLiveLogsToastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    copyLiveLogsToastTimer = null;
  }, 1200);
}

function renderVars() {
  const body = document.getElementById('vars-body');
  const visible = getVisibleVariables();
  if (!visible.length) {
    const message = showAllVariables ? 'No variables' : 'No active variables';
    body.innerHTML = `<tr><td colspan="5" class="table-message">${message}</td></tr>`;
    return;
  }
  const eyeSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>';
  const okSvg = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"></path></svg>';
  const errSvg = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>';
  body.innerHTML = visible
    .map((v) => `
      <tr>
        <td>${v.errorInfo ? errSvg : okSvg}</td>
        <td>${v.varName || v.name || v.varId || '—'}</td>
        <td>${v.docId || v.documentId || '—'}</td>
        <td>${(() => {
          const varName = v.varName || v.name || v.varId || 'var';
          const valueText = toValueString(v.value);
          const singleLine = valueText.replace(/\s+/g, ' ').trim();
          const maxLength = 25;
          const shouldShowMore = singleLine.length > maxLength || valueText.includes('\n');
          const preview = shouldShowMore ? singleLine.slice(0, maxLength) + '…' : singleLine;
          const previewHtml = `<span class="value-preview">${escapeHtml(preview)}</span>`;
          if (!shouldShowMore) {
            return previewHtml;
          }
          return `${previewHtml}<span class="pointer show-more" data-action="show-value" data-name="${escapeHtml(varName)}">Show more</span>`;
        })()}</td>
        <td><span class="pointer eye-icon" data-name="${v.varName || v.name || 'var'}">${eyeSvg}</span></td>
      </tr>
    `)
    .join('');
  attachVarClicks();
}

function switchTab(target) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === target);
  });
  document.querySelectorAll('.tab-content').forEach((pane) => {
    pane.classList.toggle('hidden', pane.dataset.content !== target);
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

document.getElementById('sync-documents').addEventListener('click', sync_documents);
document.getElementById('execute-build').addEventListener('click', executeBuild);

const copyLiveLogsButton = document.getElementById('copy-live-logs');
if (copyLiveLogsButton) {
  copyLiveLogsButton.addEventListener('click', handleCopyLiveLogs);
}

const showAllCheckbox = document.getElementById('show-all-vars');
if (showAllCheckbox) {
  showAllCheckbox.checked = false;
  showAllCheckbox.addEventListener('change', (event) => {
    showAllVariables = Boolean(event.target.checked);
    renderVars();
  });
}

function showModal(title, content) {
  const backdrop = document.getElementById('var-modal');
  const modalTitle = document.getElementById('var-modal-title');
  const body = document.getElementById('var-modal-body');
  modalTitle.textContent = title || 'Variable';
  body.value = content;
  backdrop.style.display = 'flex';
}

function closeModal() {
  document.getElementById('var-modal').style.display = 'none';
}

document.getElementById('var-modal').addEventListener('click', (e) => {
  if (e.target.id === 'var-modal' || e.target.dataset.action === 'close-modal') {
    closeModal();
  }
});

function attachVarClicks() {
  document.querySelectorAll('#vars-body tr').forEach((row) => {
    const icon = row.querySelector('.eye-icon');
    if (icon) {
      icon.addEventListener('click', () => {
        const name = icon.dataset.name;
        const variable = variables.find(v => (v.varName || v.name || v.varId) === name);
        if (!variable) return;
        showModal('Variable details', JSON.stringify(variable, null, 2));
      });
    }
    const showMore = row.querySelector('[data-action="show-value"]');
    if (showMore) {
      showMore.addEventListener('click', () => {
        const name = showMore.dataset.name;
        const variable = variables.find(v => (v.varName || v.name || v.varId) === name);
        if (!variable) return;
        const valueText = toValueString(variable.value);
        showModal(name, valueText);
      });
    }
  });
}

loadVariables();
renderErrors();
renderBuildState();
renderLiveLogs();
switchTab('errors');
