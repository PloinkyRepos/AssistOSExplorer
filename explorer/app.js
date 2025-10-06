
(() => {
  const AGENT_ROUTE = '/mcps/explorer';
  const JSON_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  let aggregatorPreferred = null;

  const state = {
    path: '/',
    includeHidden: false,
    entries: [],
    selectedPath: null,
    metadataCache: new Map()
  };

  const entriesBody = document.getElementById('entriesBody');
  const breadcrumbsEl = document.getElementById('breadcrumbs');
  const previewMeta = document.getElementById('previewMeta');
  const filePreview = document.getElementById('filePreview');
  const statusBanner = document.getElementById('statusBanner');
  const directoryPanel = document.getElementById('directoryPanel');
  const upButton = document.getElementById('upButton');
  const refreshButton = document.getElementById('refreshButton');
  const hiddenToggle = document.getElementById('hiddenToggle');
  const newDirButton = document.getElementById('newDirButton');

  function normalizePath(pathStr) {
    if (!pathStr) return '/';
    const parts = pathStr.split('/').filter(Boolean);
    return '/' + parts.join('/');
  }

  function joinPath(base, name) {
    const cleanedBase = normalizePath(base);
    const target = cleanedBase === '/' ? name : `${cleanedBase}/${name}`;
    const segments = target.split('/').filter(Boolean);
    return '/' + segments.join('/');
  }



  function parentPath(p) {
    const normalized = normalizePath(p);
    if (normalized === '/') return null;
    const segments = normalized.split('/').filter(Boolean);
    segments.pop();
    return segments.length ? `/${segments.join('/')}` : '/';
  }

  function setLoading(isLoading) {
    directoryPanel.classList.toggle('loading', Boolean(isLoading));
    refreshButton.disabled = Boolean(isLoading);
  }

  function showStatus(message, isError = false) {
    if (!message) {
      statusBanner.classList.remove('visible', 'error');
      statusBanner.textContent = '';
      return;
    }
    statusBanner.textContent = message;
    statusBanner.classList.add('visible');
    statusBanner.classList.toggle('error', Boolean(isError));
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const sized = value / Math.pow(1024, exponent);
    return `${sized.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
    } catch (_) {
      return value;
    }
  }

  function parseDirectoryListing(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const entries = lines.map(line => {
      const match = line.match(/^\[(DIR|FILE)\]\s+(.*)$/);
      if (!match) {
        return { name: line, type: 'unknown' };
      }
      return {
        name: match[2],
        type: match[1] === 'DIR' ? 'directory' : 'file'
      };
    });
    entries.sort((a, b) => {
      const order = { directory: 0, file: 1, unknown: 2 };
      const diff = (order[a.type] || 3) - (order[b.type] || 3);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return entries;
  }

  function parseFileInfo(text) {
    const result = {};
    text.split(/\r?\n/).forEach(line => {
      const [key, ...rest] = line.split(':');
      if (!key || !rest.length) return;
      const value = rest.join(':').trim();
      const normalizedKey = key.trim().toLowerCase();
      result[normalizedKey] = value;
    });
    return result;
  }

  function parseToolResult(result) {
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const firstText = blocks.find(block => block?.type === 'text')?.text;
    if (typeof firstText !== 'string') {
      throw new Error('Agent response did not include text content.');
    }
    return { text: firstText, blocks, raw: result };
  }

  async function sendViaAggregator(tool, args, headers) {
    const payload = { command: 'tool', tool, ...args };
    const response = await fetch(AGENT_ROUTE, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      if ([400, 404, 406, 415].includes(response.status)) {
        const error = new Error(`HTTP ${response.status}: ${text || 'request failed'}`);
        error.fallback = true;
        throw error;
      }
      throw new Error(`HTTP ${response.status}: ${text || 'request failed'}`);
    }
    const data = await response.json();
    if (data?.ok === false) {
      const error = new Error(data?.error || 'Agent returned an error');
      error.fallback = true;
      throw error;
    }
    return parseToolResult(data?.result || data);
  }

  async function sendViaJsonRpc(tool, args, headers) {
    const rpcPayload = {
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method: 'tools/call',
      params: { name: tool, arguments: args }
    };
    const response = await fetch(AGENT_ROUTE, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcPayload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text || 'request failed'}`);
    }
    const data = await response.json();
    if (data?.error) {
      throw new Error(data.error?.message || 'Agent returned an error');
    }
    return parseToolResult(data?.result);
  }

  function shouldFallbackToAggregator(error) {
    const message = (error && error.message ? String(error.message) : '').toLowerCase();
    if (!message.length) return false;
    return message.includes('missing tool name') ||
      message.includes('unknown command') ||
      message.includes('no mcp agents') ||
      message.includes('invalid request');
  }

  async function callTool(tool, args = {}) {
    const headers = { ...JSON_HEADERS };

    if (aggregatorPreferred === true) {
      try {
        return await sendViaAggregator(tool, args, headers);
      } catch (err) {
        if (err?.fallback) {
          aggregatorPreferred = false;
        } else {
          throw err;
        }
      }
    }

    try {
      const result = await sendViaJsonRpc(tool, args, headers);
      if (aggregatorPreferred === null) {
        aggregatorPreferred = false;
      }
      return result;
    } catch (err) {
      if (shouldFallbackToAggregator(err)) {
        aggregatorPreferred = true;
        return await sendViaAggregator(tool, args, headers);
      }
      throw err;
    }
  }

  function renderBreadcrumbs(path) {
    breadcrumbsEl.innerHTML = '';
    const rootButton = document.createElement('button');
    rootButton.textContent = '/';
    rootButton.addEventListener('click', () => loadDirectory('/'));
    breadcrumbsEl.appendChild(rootButton);

    if (!path || path === '/') return;

    const segments = path.split('/').filter(Boolean);
    let current = '';
    segments.forEach(segment => {
      current += `/${segment}`;
      breadcrumbsEl.appendChild(document.createTextNode('/'));
      const btn = document.createElement('button');
      btn.textContent = segment;
      btn.addEventListener('click', () => loadDirectory(current));
      breadcrumbsEl.appendChild(btn);
    });
  }

  function setActiveRow(path) {
    Array.from(entriesBody.querySelectorAll('tr')).forEach(row => {
      row.classList.toggle('active', row.dataset.path === path);
    });
    state.selectedPath = path || null;
  }

  function renderEntries(entries) {
    entriesBody.innerHTML = '';
    const filtered = entries.filter(entry => state.includeHidden || !entry.name.startsWith('.'));
    if (!filtered.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = 'Empty directory.';
      row.appendChild(cell);
      entriesBody.appendChild(row);
      return;
    }

    filtered.forEach(entry => {
      const row = document.createElement('tr');
      const entryPath = joinPath(state.path, entry.name);
      row.dataset.path = entryPath;
      row.dataset.type = entry.type;

      const nameCell = document.createElement('td');
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = entry.type === 'directory' ? '📁' : entry.type === 'file' ? '📄' : '📦';
      const wrapper = document.createElement('div');
      wrapper.className = 'entry-name';
      const text = document.createElement('span');
      text.textContent = entry.name;
      wrapper.append(icon, text);
      nameCell.appendChild(wrapper);

      const typeCell = document.createElement('td');
      typeCell.textContent = entry.type;

      const sizeCell = document.createElement('td');
      sizeCell.textContent = entry.type === 'directory' ? '—' : formatBytes(entry.bytes ?? entry.size ?? 0);

      const modifiedCell = document.createElement('td');
      modifiedCell.textContent = entry.modified ? formatDate(entry.modified) : '—';

      row.append(nameCell, typeCell, sizeCell, modifiedCell);

      row.addEventListener('click', () => {
        if (entry.type === 'directory') {
          loadDirectory(entryPath);
        } else if (entry.type === 'file') {
          openFile(entryPath);
          setActiveRow(entryPath);
        }
      });

      entriesBody.appendChild(row);
    });
  }

  function renderPreview(data) {
    if (!data || data.error) {
      previewMeta.innerHTML = '<span>Error reading file.</span>';
      filePreview.textContent = data?.error || '';
      return;
    }
    const details = [
      `<div><strong>Path:</strong> ${data.path}</div>`,
      `<div><strong>Size:</strong> ${formatBytes(Number(data.size))}</div>`,
      `<div><strong>Modified:</strong> ${formatDate(data.modified)}</div>`,
      `<div><strong>Permissions:</strong> ${data.permissions || '—'}</div>`
    ];
    if (data.truncated) {
      details.push('<div class="badge">Preview truncated</div>');
    }
    previewMeta.innerHTML = details.join('');

    if (data.binary) {
      filePreview.textContent = 'Binary content (base64):\n\n' + data.content;
    } else {
      filePreview.textContent = data.content || '';
    }
  }

  async function loadDirectory(targetPath = state.path) {
    try {
      setLoading(true);
      showStatus('Loading directory...', false);
      const result = await callTool('list_directory', { path: targetPath });
      const parsedEntries = parseDirectoryListing(result.text).map(entry => ({
        ...entry,
        path: joinPath(targetPath, entry.name)
      }));
      state.path = normalizePath(targetPath);
      state.parent = parentPath(state.path);
      state.entries = parsedEntries;
      renderBreadcrumbs(state.path);
      renderEntries(state.entries);
      showStatus(`Current directory: ${state.path}`, false);
      setActiveRow(null);
    } catch (err) {
      console.error(err);
      showStatus(err.message || 'Failed to load directory.', true);
    } finally {
      setLoading(false);
    }
  }

  async function loadFileMetadata(filePath) {
    if (state.metadataCache.has(filePath)) return state.metadataCache.get(filePath);
    try {
      const infoResult = await callTool('get_file_info', { path: filePath });
      const parsed = parseFileInfo(infoResult.text);
      const meta = {
        size: Number(parsed.size) || NaN,
        modified: parsed.modified || parsed.mtime || null,
        permissions: parsed.permissions || null
      };
      state.metadataCache.set(filePath, meta);
      return meta;
    } catch (error) {
      console.warn('Unable to fetch metadata for', filePath, error);
      return { size: NaN, modified: null, permissions: null };
    }
  }

  async function openFile(filePath) {
    try {
      setLoading(true);
      showStatus(`Loading file ${filePath}...`, false);
      const [contentResult, meta] = await Promise.all([
        callTool('read_text_file', { path: filePath }),
        loadFileMetadata(filePath)
      ]);
      renderPreview({
        path: filePath,
        size: meta.size,
        modified: meta.modified,
        permissions: meta.permissions,
        encoding: 'utf8',
        truncated: false,
        binary: false,
        content: contentResult.text
      });
      showStatus(`Viewing ${filePath}`, false);
    } catch (err) {
      console.error(err);
      renderPreview({ error: err.message });
      showStatus(err.message || 'Failed to read file.', true);
    } finally {
      setLoading(false);
    }
  }

  upButton.addEventListener('click', () => {
    if (!state.parent) return;
    loadDirectory(state.parent);
  });

  refreshButton.addEventListener('click', () => {
    loadDirectory(state.path);
  });

  hiddenToggle.addEventListener('change', event => {
    state.includeHidden = event.target.checked;
    renderEntries(state.entries);
  });

  newDirButton.addEventListener('click', async () => {
    const dirName = prompt('Enter name for the new directory:');
    if (!dirName || !dirName.trim()) {
      return;
    }
    const newDirPath = joinPath(state.path, dirName.trim());
    try {
      setLoading(true);
      showStatus(`Creating directory "${newDirPath}"...`, false);
      await callTool('create_directory', { path: newDirPath });
      showStatus(`Successfully created directory.`, false);
      await loadDirectory(state.path); // Refresh view
    } catch (err) {
      console.error(err);
      showStatus(err.message || 'Failed to create directory.', true);
    } finally {
      setLoading(false);
    }
  });

  loadDirectory('/');
})();
