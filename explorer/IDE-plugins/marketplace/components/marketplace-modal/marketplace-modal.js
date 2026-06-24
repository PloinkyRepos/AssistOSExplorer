import {
  callExplorerTool,
  parseToolResult
} from '/explorer/services/infrastructure/explorerApi.js';
import {
  buildAgentSettingsItems
} from '/explorer/web-components/modals/settings-modal/settings-agent-model.js';
import {
  ensureSettingsComponentRegistered,
  resolvePluginSettingsUrl
} from '/explorer/web-components/modals/settings-modal/settings-component-loader.js';
import {
  flattenPluginsByKey,
  getCachedRuntimePlugins
} from '/explorer/web-components/modals/settings-modal/settings-plugin-model.js';

export class MarketplaceModal {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.state = {
      marketplace: null,
      activeTab: 'agents',
      busy: false,
      status: 'Loading marketplace...',
      statusType: '',
      agentSearchInput: '',
      agentSearchQuery: '',
      activeRepoKindTab: 'agents',
      expandedAgentRepos: {},
      agentSettingsRaw: [],
      agentSettingsItems: [],
      agentSettingsDataLoaded: false,
      agentSettingsBusyKey: ''
    };
    this.invalidate();
  }

  beforeRender() {}

  afterRender() {
    this.repoNameInput = this.element.querySelector('#marketplaceRepoName');
    this.repoUrlInput = this.element.querySelector('#marketplaceRepoUrl');
    this.repoBranchInput = this.element.querySelector('#marketplaceRepoBranch');
    this.addRepoButton = this.element.querySelector('#marketplaceAddRepo');
    this.statusEl = this.element.querySelector('#marketplaceStatus');
    this.repositoriesEl = this.element.querySelector('#marketplaceRepositories');
    this.agentsEl = this.element.querySelector('#marketplaceAgents');
    this.agentSearchInput = this.element.querySelector('#marketplaceAgentSearch');
    this.tabButtons = Array.from(this.element.querySelectorAll('[data-tab]'));
    this.tabPanels = Array.from(this.element.querySelectorAll('[data-panel]'));
    this.repoKindButtons = Array.from(this.element.querySelectorAll('[data-repo-kind-tab]'));

    this.element.querySelector('[data-action="close"]')?.addEventListener('click', this.close);
    this.addRepoButton?.addEventListener('click', this.addRepository);
    this.repoUrlInput?.addEventListener('input', this.suggestRepoName);
    this.agentSearchInput?.addEventListener('input', this.handleAgentSearchInput);
    this.agentsEl?.addEventListener('click', this.handleAgentClick);
    this.repositoriesEl?.addEventListener('click', this.handleRepositoryClick);
    this.tabButtons.forEach(button => button.addEventListener('click', this.switchTab));
    this.repoKindButtons.forEach(button => button.addEventListener('click', this.switchRepoKindTab));

    this.renderState();
    if (!this.state.marketplace && !this.loadingStarted) {
      this.loadingStarted = true;
      this.loadMarketplace();
    } else if (this.canManageMarketplace() && !this.state.agentSettingsDataLoaded) {
      this.loadAgentSettingsData().catch((error) => {
        this.setStatus(error?.message || 'Failed to load agent settings.', 'error');
      });
    }
  }

  afterUnload() {
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
      this.statusClearTimer = null;
    }
    if (this.agentSearchTimer) {
      clearTimeout(this.agentSearchTimer);
      this.agentSearchTimer = null;
    }
    this.element.querySelector('[data-action="close"]')?.removeEventListener('click', this.close);
    this.addRepoButton?.removeEventListener('click', this.addRepository);
    this.repoUrlInput?.removeEventListener('input', this.suggestRepoName);
    this.agentSearchInput?.removeEventListener('input', this.handleAgentSearchInput);
    this.agentsEl?.removeEventListener('click', this.handleAgentClick);
    this.repositoriesEl?.removeEventListener('click', this.handleRepositoryClick);
    this.tabButtons?.forEach(button => button.removeEventListener('click', this.switchTab));
    this.repoKindButtons?.forEach(button => button.removeEventListener('click', this.switchRepoKindTab));
  }

  close = () => {
    const dialog = this.element.closest('dialog');
    if (dialog && typeof dialog.close === 'function') {
      dialog.close();
      return;
    }
    window.close();
    setTimeout(() => {
      window.assistOS?.UI?.changeToDynamicPage?.('file-exp', 'file-exp');
    }, 100);
  };

  closeModal() {
    this.close();
  }

  setStatus(message, type = '') {
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
      this.statusClearTimer = null;
    }
    this.state.status = message;
    this.state.statusType = type;
    this.renderState();
    if (type === 'error' && message) {
      this.statusClearTimer = setTimeout(() => {
        this.statusClearTimer = null;
        if (this.state.statusType === 'error') {
          this.state.status = '';
          this.state.statusType = '';
          this.renderState();
        }
      }, 5000);
    }
  }

  setBusy(busy) {
    this.state.busy = Boolean(busy);
    this.renderState();
  }

  switchTab = (event) => {
    const tab = event.currentTarget?.dataset?.tab || 'agents';
    this.state.activeTab = tab === 'repos' ? 'repos' : 'agents';
    this.renderState();
  };

  switchRepoKindTab = (event) => {
    const tab = event.currentTarget?.dataset?.repoKindTab || 'agents';
    this.state.activeRepoKindTab = ['agents', 'skills', 'others'].includes(tab) ? tab : 'agents';
    this.renderState();
  };

  async requestMarketplace(actionBody = null, options = {}) {
    const fetchOptions = {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    };
    let url = '/api/marketplace';
    if (actionBody) {
      fetchOptions.method = 'POST';
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(actionBody);
    }
    const response = await fetch(url, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || data?.error || `Marketplace request failed (${response.status})`);
    }
    return options.raw === true ? data : data.marketplace;
  }

  async loadMarketplace() {
    this.setBusy(true);
    try {
      this.state.marketplace = await this.requestMarketplace();
      if (this.canManageMarketplace()) {
        await this.loadAgentSettingsData();
      }
      this.setStatus('');
    } catch (error) {
      this.setStatus(error?.message || 'Failed to load marketplace.', 'error');
    } finally {
      this.setBusy(false);
    }
  }

  async loadAgentSettingsData() {
    let pluginsByLocation = getCachedRuntimePlugins();
    if (!pluginsByLocation) {
      const pluginsPayload = await callExplorerTool('collect_ide_plugins', {}, { raw: true, withLoader: false });
      pluginsByLocation = parseToolResult(pluginsPayload) || {};
    }
    this.state.agentSettingsRaw = Array.isArray(pluginsByLocation?.agentSettings)
      ? pluginsByLocation.agentSettings
      : [];
    const pluginItems = flattenPluginsByKey(pluginsByLocation);
    this.state.agentSettingsItems = buildAgentSettingsItems(this.state.agentSettingsRaw, pluginItems, { isAdmin: true });
    this.state.agentSettingsDataLoaded = true;
  }

  suggestRepoName = () => {
    if (!this.repoNameInput || this.repoNameInput.value.trim()) return;
    const url = String(this.repoUrlInput?.value || '').trim();
    const match = url.match(/\/([^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
    if (!match) return;
    const name = match[1].replace(/[^a-zA-Z0-9_.-]+/g, '-');
    if (name) this.repoNameInput.value = name;
  };

  handleAgentSearchInput = (event) => {
    const value = String(event.target?.value || '').trim();
    this.state.agentSearchInput = value;
    if (this.agentSearchTimer) {
      clearTimeout(this.agentSearchTimer);
    }
    this.agentSearchTimer = setTimeout(() => {
      this.agentSearchTimer = null;
      this.state.agentSearchQuery = this.state.agentSearchInput;
      this.renderState();
    }, 500);
  };

  addRepository = async () => {
    const name = String(this.repoNameInput?.value || '').trim();
    const url = String(this.repoUrlInput?.value || '').trim();
    const branch = String(this.repoBranchInput?.value || '').trim();
    if (!url) {
      this.setStatus('Repository URL is required.', 'error');
      return;
    }
    this.setBusy(true);
    this.setStatus(`Installing ${name || url}...`);
    try {
      const response = await this.requestMarketplace({
        action: 'install_repo',
        url,
        ...(name ? { name } : {}),
        ...(branch ? { branch } : {})
      }, { raw: true });
      this.state.marketplace = response?.marketplace || response;
      this.repoNameInput.value = '';
      this.repoUrlInput.value = '';
      this.repoBranchInput.value = '';
      const result = response?.result || {};
      this.setStatus(`${result.name || name || url} installed.`);
    } catch (error) {
      this.setStatus(error?.message || 'Failed to install repository.', 'error');
    } finally {
      this.setBusy(false);
    }
  };

  handleAgentClick = async (event) => {
    if (this.state.busy) return;

    const repoToggle = event.target?.closest?.('[data-repo-tree-toggle]');
    if (repoToggle) {
      this.toggleAgentRepo(repoToggle.dataset.repoName || '');
      return;
    }

    const settingsButton = event.target?.closest?.('[data-agent-settings-key]');
    if (settingsButton) {
      await this.openAgentSettings(settingsButton.dataset.agentSettingsKey || '');
      return;
    }

    const button = event.target?.closest?.('[data-agent-ref]');
    if (!button) return;

    const agentRef = button.dataset.agentRef || '';
    const active = button.dataset.active === 'true';
    const controls = button.closest?.('.marketplace-agent-controls');
    const modeSelect = controls?.querySelector?.('[data-enable-mode-for]');
    const mode = String(modeSelect?.value || button.dataset.enableMode || 'isolated').trim() || 'isolated';

    this.setBusy(true);
    this.setStatus(`${active ? 'Disabling' : 'Enabling'} ${agentRef}...`);
    try {
      this.state.marketplace = await this.requestMarketplace({
        action: active ? 'disable_agent' : 'enable_agent',
        agentRef,
        ...(!active ? { mode } : {})
      });
      this.setStatus(`${agentRef} ${active ? 'disabled' : 'enabled'}.`);
    } catch (error) {
      this.setStatus(error?.message || 'Failed to update agent.', 'error');
    } finally {
      this.setBusy(false);
    }
  };

  normalizeAgentSettingsMatchKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  getAgentSettingsCandidates(agent) {
    const repo = String(agent?.repo || '').trim();
    const name = String(agent?.name || '').trim();
    const ref = String(agent?.ref || '').trim();
    return new Set([
      ref,
      name,
      repo && name ? `${repo}/${name}` : '',
      ref.includes('/') ? ref.split('/').pop() : ''
    ].map((value) => this.normalizeAgentSettingsMatchKey(value)).filter(Boolean));
  }

  getAgentSettingsItem(agent) {
    const candidates = this.getAgentSettingsCandidates(agent);
    return (this.state.agentSettingsItems || []).find((item) => {
      if (!item?.available) return false;
      const ownerAgent = this.normalizeAgentSettingsMatchKey(item.ownerAgent);
      const key = this.normalizeAgentSettingsMatchKey(item.key);
      return candidates.has(ownerAgent) || candidates.has(key);
    }) || null;
  }

  async openAgentSettings(key) {
    if (!key || !this.canManageMarketplace()) return;
    if (!this.state.agentSettingsDataLoaded) {
      await this.loadAgentSettingsData();
    }
    const item = (this.state.agentSettingsItems || []).find((entry) => entry?.key === key);
    if (!item || !item.available || !item.sourcePlugin || (!item.settingsUrl && !item.settingsComponent)) {
      this.setStatus('Agent settings are not available.', 'error');
      return;
    }

    this.state.agentSettingsBusyKey = key;
    this.renderState();

    try {
      if (item.settingsUrl) {
        if (!this.openAgentSettingsUrlPopup(item)) {
          throw new Error(`Invalid settings URL for ${key}.`);
        }
        this.setStatus(`${item.label || item.component} settings opened.`);
        return;
      }

      await ensureSettingsComponentRegistered({
        ...item.sourcePlugin,
        settingsComponent: item.settingsComponent
      });
      const modal = await assistOS.UI.createReactiveModal(item.settingsComponent, {
        agentSettings: {
          key: item.key,
          label: item.label,
          ownerAgent: item.ownerAgent,
          scope: item.scope,
          settingsComponent: item.settingsComponent,
          settingsUrl: item.settingsUrl,
          assetRootPath: item.assetRootPath
        }
      });
      modal?.classList?.add?.('marketplace-agent-settings-dialog');
      this.setStatus(`${item.label} settings opened.`);
    } catch (error) {
      this.setStatus(error?.message || `Failed to open settings for ${key}.`, 'error');
    } finally {
      this.state.agentSettingsBusyKey = '';
      this.renderState();
    }
  }

  openAgentSettingsUrlPopup(item) {
    const settingsUrl = resolvePluginSettingsUrl(item);
    if (!settingsUrl) return false;

    const dialog = document.createElement('dialog');
    dialog.className = 'modal marketplace-agent-settings-dialog';

    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = item.label || item.key || 'Agent settings';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'marketplace-agent-settings-close';
    closeButton.setAttribute('aria-label', 'Close settings');
    closeButton.textContent = 'Close';

    const body = document.createElement('div');
    body.className = 'marketplace-agent-settings-dialog-body';

    const frame = document.createElement('iframe');
    frame.className = 'marketplace-agent-settings-frame';
    frame.title = title.textContent;
    frame.src = settingsUrl;

    body.append(frame);
    header.append(title, closeButton);
    dialog.append(header, body);
    document.body.append(dialog);

    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    return true;
  }

  toggleAgentRepo = (repoName) => {
    const name = String(repoName || '').trim();
    if (!name) return;
    const expandedAgentRepos = { ...(this.state.expandedAgentRepos || {}) };
    expandedAgentRepos[name] = !Boolean(expandedAgentRepos[name]);
    this.state.expandedAgentRepos = expandedAgentRepos;
    this.renderState();
  };

  handleRepositoryClick = async (event) => {
    const button = event.target?.closest?.('[data-repo-name]');
    if (!button || this.state.busy) return;
    const name = button.dataset.repoName || '';
    const installed = button.dataset.installed === 'true';
    const url = button.dataset.repoUrl || '';
    this.setBusy(true);
    this.setStatus(`${installed ? 'Uninstalling' : 'Installing'} ${name || url}...`);
    try {
      const payload = installed
        ? { action: 'uninstall_repo', target: name || url }
        : { action: 'install_repo', url, ...(name ? { name } : {}) };
      const response = await this.requestMarketplace(payload, { raw: true });
      this.state.marketplace = response?.marketplace || response;
      const resultName = response?.result?.name || name || url;
      this.setStatus(`${resultName} ${installed ? 'uninstalled' : 'installed'}.`);
    } catch (error) {
      this.setStatus(error?.message || 'Failed to update repository installation.', 'error');
    } finally {
      this.setBusy(false);
    }
  };

  renderState() {
    this.renderTabs();
    const canManage = this.canManageMarketplace();
    if (this.statusEl) {
      this.statusEl.textContent = this.state.status || '';
      this.statusEl.classList.toggle('error', this.state.statusType === 'error');
    }
    if (this.addRepoButton) this.addRepoButton.disabled = this.state.busy;
    if (this.agentSearchInput && this.agentSearchInput.value !== this.state.agentSearchInput) {
      this.agentSearchInput.value = this.state.agentSearchInput;
    }
    this.element.querySelector('.marketplace-repo-tools')?.classList.toggle('hidden', !canManage);
    this.renderRepoKindTabs();
    this.renderRepositories();
    this.renderAgents();
  }

  canManageMarketplace() {
    return this.state.marketplace?.permissions?.canManage === true;
  }

  renderTabs() {
    const active = this.state.activeTab || 'agents';
    this.tabButtons?.forEach(button => {
      const isActive = button.dataset.tab === active;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    this.tabPanels?.forEach(panel => {
      const isActive = panel.dataset.panel === active;
      panel.classList.toggle('hidden', !isActive);
      panel.hidden = !isActive;
    });
  }

  renderRepoKindTabs() {
    const active = ['agents', 'skills', 'others'].includes(this.state.activeRepoKindTab)
      ? this.state.activeRepoKindTab
      : 'agents';
    this.repoKindButtons?.forEach(button => {
      const isActive = button.dataset.repoKindTab === active;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  repoMatchesKindTab(repo, activeTab = this.state.activeRepoKindTab) {
    const kind = String(repo?.kind || '').trim().toLowerCase();
    if (activeTab === 'skills') {
      return kind === 'skills' || kind === 'mixed';
    }
    if (activeTab === 'others') {
      return kind !== 'agents' && kind !== 'skills' && kind !== 'mixed';
    }
    return kind === 'agents' || kind === 'mixed';
  }

  renderRepositories() {
    if (!this.repositoriesEl) return;
    const repositories = this.state.marketplace?.repositories || [];
    if (!repositories.length) {
      this.repositoriesEl.innerHTML = '<div class="marketplace-empty">No repositories found.</div>';
      return;
    }
    const activeRepoKindTab = ['agents', 'skills', 'others'].includes(this.state.activeRepoKindTab)
      ? this.state.activeRepoKindTab
      : 'agents';
    const filteredRepositories = repositories.filter(repo => this.repoMatchesKindTab(repo, activeRepoKindTab));
    if (!filteredRepositories.length) {
      const label = activeRepoKindTab === 'skills' ? 'skills' : (activeRepoKindTab === 'others' ? 'other' : 'agent');
      this.repositoriesEl.innerHTML = `<div class="marketplace-empty">No ${label} repositories found.</div>`;
      return;
    }

    this.repositoriesEl.replaceChildren(...filteredRepositories.map(repo => {
      const canManage = this.canManageMarketplace();
      const row = document.createElement('article');
      row.className = 'marketplace-row';
      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'marketplace-title';
      title.textContent = repo.name;
      const description = document.createElement('div');
      description.className = 'marketplace-description';
      description.textContent = repo.description || repo.url || '';
      const activeAgentsCount = Number(repo.activeAgentsCount || 0);
      const note = document.createElement('div');
      note.className = 'marketplace-meta';
      note.textContent = activeAgentsCount > 0
        ? `${activeAgentsCount} enabled agent${activeAgentsCount === 1 ? '' : 's'} will be removed if this repo is uninstalled.`
        : '';
      info.append(title, description);
      if (note.textContent) info.append(note);
      row.append(info);
      if (canManage) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = `marketplace-repo-toggle${repo.installed ? ' active' : ''}`;
        toggle.dataset.repoName = repo.name;
        toggle.dataset.repoUrl = repo.url || '';
        toggle.dataset.installed = repo.installed ? 'true' : 'false';
        toggle.disabled = this.state.busy || (!repo.installed && !repo.url);
        toggle.textContent = repo.installed ? 'Uninstall' : 'Install';
        row.append(toggle);
      }
      return row;
    }));
  }

  getAgentDisplayName(agent) {
    const ref = String(agent?.ref || '').trim();
    if (ref.includes('/')) {
      const parts = ref.split('/');
      return parts[parts.length - 1] || ref;
    }
    if (agent?.name) return String(agent.name);
    return ref || 'Unknown agent';
  }

  renderAgents() {
    if (!this.agentsEl) return;
    const repositories = this.state.marketplace?.repositories || [];
    const agents = this.state.marketplace?.agents || [];
    const canManage = this.canManageMarketplace();
    const noRepoName = '__no_repo__';
    const noRepoLabel = '(No repository)';

    if (!repositories.length && !agents.length) {
      this.agentsEl.innerHTML = '<div class="marketplace-empty">No agents found.</div>';
      return;
    }

    const agentsByRepo = new Map();
    for (const agent of agents) {
      const repoName = String(agent?.repo || '').trim() || noRepoName;
      const list = agentsByRepo.get(repoName);
      if (list) {
        list.push(agent);
      } else {
        agentsByRepo.set(repoName, [agent]);
      }
    }

    const repoEntries = [];
    const usedRepoNames = new Set();
    for (const repo of repositories) {
      const repoName = String(repo?.name || '').trim() || noRepoName;
      usedRepoNames.add(repoName);
      repoEntries.push({
        repoName,
        repoLabel: repoName === noRepoName ? noRepoLabel : repoName,
        repo,
        agents: agentsByRepo.get(repoName) || [],
        hasMetadata: true
      });
    }

    for (const [repoName, list] of agentsByRepo.entries()) {
      if (usedRepoNames.has(repoName)) continue;
      repoEntries.push({
        repoName,
        repoLabel: repoName === noRepoName ? noRepoLabel : repoName,
        repo: { name: repoName === noRepoName ? '' : repoName },
        agents: list,
        hasMetadata: false
      });
    }

    const query = String(this.state.agentSearchQuery || '').trim().toLowerCase();
    const hasQuery = Boolean(query);
    const queryIncludes = (value) => String(value || '').toLowerCase().includes(query);

    const filteredEntries = repoEntries.filter(entry => {
      const repo = entry.repo || {};
      const repoMatches = !hasQuery
        ? true
        : [
            entry.repoLabel,
            repo.url,
            repo.description,
            repo.kind
          ].some(value => queryIncludes(value));

      const matchingAgents = hasQuery
        ? entry.agents.filter(agent => {
            const searchValues = [
              agent.ref,
              agent.repo,
              agent.name,
              `${agent.repo || ''}/${agent.name || ''}`
            ];
            return searchValues.some(value => queryIncludes(value));
          })
        : [];

      entry.matchingAgents = matchingAgents;
      return !hasQuery || repoMatches || matchingAgents.length > 0;
    });

    if (!filteredEntries.length) {
      this.agentsEl.innerHTML = '<div class="marketplace-empty">No agents or repositories match the search.</div>';
      return;
    }

    const createAgentRow = (agent) => {
      const row = document.createElement('article');
      row.className = 'marketplace-row marketplace-agent-row';

      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'marketplace-title';
      const name = document.createElement('span');
      name.textContent = this.getAgentDisplayName(agent);
      const status = document.createElement('span');
      const statusText = String(agent.status || (agent.active ? 'stopped' : 'inactive')).toLowerCase();
      status.className = `marketplace-agent-status ${statusText}`;
      status.textContent = statusText;
      title.append(name, status);

      const about = document.createElement('div');
      about.className = 'marketplace-description';
      about.textContent = agent.about || 'No description';
      info.append(title, about);

      row.append(info);
      const controls = document.createElement('div');
      controls.className = 'marketplace-agent-controls';

      const modeSelect = document.createElement('select');
      modeSelect.className = 'marketplace-enable-mode';
      modeSelect.dataset.enableModeFor = agent.ref;
      const modes = Array.isArray(agent.enableModes) && agent.enableModes.length
        ? agent.enableModes
        : ['isolated', 'global', 'devel'];
      const currentMode = modes.includes(agent.enableMode) ? agent.enableMode : 'isolated';
      for (const mode of modes) {
        const option = document.createElement('option');
        option.value = mode;
        option.textContent = mode;
        modeSelect.append(option);
      }
      modeSelect.value = currentMode;
      modeSelect.disabled = this.state.busy || !canManage || agent.active;

      if (canManage) {
        const settingsItem = this.getAgentSettingsItem(agent);
        if (settingsItem) {
          const settingsButton = document.createElement('button');
          settingsButton.type = 'button';
          settingsButton.className = 'marketplace-agent-settings';
          settingsButton.dataset.agentSettingsKey = settingsItem.key;
          settingsButton.disabled = this.state.busy || this.state.agentSettingsBusyKey === settingsItem.key;
          settingsButton.textContent = 'Configure';
          controls.append(settingsButton);
        }

        controls.append(modeSelect);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = `marketplace-agent-toggle${agent.active ? ' active' : ''}`;
        toggle.dataset.agentRef = agent.ref;
        toggle.dataset.active = agent.active ? 'true' : 'false';
        toggle.dataset.enableMode = currentMode;
        toggle.disabled = this.state.busy;
        toggle.textContent = agent.active ? 'Disable' : 'Enable';
        controls.append(toggle);
      } else {
        controls.append(modeSelect);
      }

      row.append(controls);
      return row;
    };

    this.agentsEl.replaceChildren(...filteredEntries.map(entry => {
      const repoMatches = !hasQuery
        ? false
        : [
            entry.repoLabel,
            entry.repo.url,
            entry.repo.description,
            entry.repo.kind
          ].some(value => queryIncludes(value));
      const hasAgentMatches = hasQuery ? entry.matchingAgents.length > 0 : false;
      const isExpandedBySearch = hasQuery && (repoMatches || hasAgentMatches);
      const isExpanded = Boolean(isExpandedBySearch || this.state.expandedAgentRepos?.[entry.repoName]);
      const visibleAgents = hasQuery ? entry.matchingAgents : entry.agents;
      const hasAgents = (entry.agents || []).length > 0;

      const wrapper = document.createElement('article');
      wrapper.className = 'marketplace-repo-tree-node';

      const header = document.createElement('div');
      header.className = 'marketplace-row marketplace-repo-row';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `marketplace-tree-toggle${isExpanded ? ' expanded' : ''}`;
      toggle.dataset.repoTreeToggle = '1';
      toggle.dataset.repoName = entry.repoName;
      toggle.disabled = !hasAgents;
      toggle.setAttribute('aria-expanded', String(Boolean(isExpanded)));
      toggle.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} agents for ${entry.repoLabel}`);
      const arrow = document.createElement('span');
      arrow.className = 'marketplace-tree-arrow';
      arrow.textContent = '›';
      toggle.append(arrow);

      const info = document.createElement('div');
      info.className = 'marketplace-repo-info';
      const title = document.createElement('div');
      title.className = 'marketplace-title marketplace-repo-title';
      title.textContent = entry.repoLabel;
      info.append(title);

      header.append(toggle, info);

      const children = document.createElement('div');
      children.className = 'marketplace-agent-tree-children';
      children.dataset.repoName = entry.repoName;
      children.hidden = !isExpanded;

      if (visibleAgents.length > 0) {
        children.replaceChildren(...visibleAgents.map(createAgentRow));
      } else {
        children.innerHTML = `<div class="marketplace-empty marketplace-tree-empty">${
          hasQuery ? 'No agents match the search in this repository.' : 'No agents in this repository.'
        }</div>`;
      }

      wrapper.append(header, children);
      return wrapper;
    }));
  }
}
