export class MarketplaceModal {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.state = {
      marketplace: null,
      activeTab: 'agents',
      busy: false,
      status: 'Loading marketplace...',
      statusType: ''
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
    this.tabButtons = Array.from(this.element.querySelectorAll('[data-tab]'));
    this.tabPanels = Array.from(this.element.querySelectorAll('[data-panel]'));

    this.element.querySelector('[data-action="close"]')?.addEventListener('click', this.close);
    this.addRepoButton?.addEventListener('click', this.addRepository);
    this.repoUrlInput?.addEventListener('input', this.suggestRepoName);
    this.agentsEl?.addEventListener('click', this.handleAgentClick);
    this.repositoriesEl?.addEventListener('click', this.handleRepositoryClick);
    this.tabButtons.forEach(button => button.addEventListener('click', this.switchTab));

    this.renderState();
    if (!this.state.marketplace && !this.loadingStarted) {
      this.loadingStarted = true;
      this.loadMarketplace();
    }
  }

  afterUnload() {
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
      this.statusClearTimer = null;
    }
    this.element.querySelector('[data-action="close"]')?.removeEventListener('click', this.close);
    this.addRepoButton?.removeEventListener('click', this.addRepository);
    this.repoUrlInput?.removeEventListener('input', this.suggestRepoName);
    this.agentsEl?.removeEventListener('click', this.handleAgentClick);
    this.repositoriesEl?.removeEventListener('click', this.handleRepositoryClick);
    this.tabButtons?.forEach(button => button.removeEventListener('click', this.switchTab));
  }

  close = () => {
    const dialog = this.element.closest('dialog');
    if (dialog && typeof dialog.close === 'function') {
      dialog.close();
      return;
    }
    this.element.remove();
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

  async requestMarketplace(actionBody = null) {
    const options = {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    };
    let url = '/api/marketplace';
    if (actionBody) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(actionBody);
    }
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || data?.error || `Marketplace request failed (${response.status})`);
    }
    return data.marketplace;
  }

  async loadMarketplace() {
    this.setBusy(true);
    try {
      this.state.marketplace = await this.requestMarketplace();
      this.setStatus('');
    } catch (error) {
      this.setStatus(error?.message || 'Failed to load marketplace.', 'error');
    } finally {
      this.setBusy(false);
    }
  }

  suggestRepoName = () => {
    if (!this.repoNameInput || this.repoNameInput.value.trim()) return;
    const url = String(this.repoUrlInput?.value || '').trim();
    const match = url.match(/\/([^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
    if (!match) return;
    const name = match[1].replace(/[^a-zA-Z0-9_.-]+/g, '-');
    if (name) this.repoNameInput.value = name;
  };

  addRepository = async () => {
    const name = String(this.repoNameInput?.value || '').trim();
    const url = String(this.repoUrlInput?.value || '').trim();
    const branch = String(this.repoBranchInput?.value || '').trim();
    if (!name || !url) {
      this.setStatus('Repository name and URL are required.', 'error');
      return;
    }
    this.setBusy(true);
    this.setStatus(`Adding ${name}...`);
    try {
      this.state.marketplace = await this.requestMarketplace({
        action: 'add_repository',
        name,
        url,
        ...(branch ? { branch } : {})
      });
      this.repoNameInput.value = '';
      this.repoUrlInput.value = '';
      this.repoBranchInput.value = '';
      this.setStatus(`${name} added.`);
    } catch (error) {
      this.setStatus(error?.message || 'Failed to add repository.', 'error');
    } finally {
      this.setBusy(false);
    }
  };

  handleAgentClick = async (event) => {
    const button = event.target?.closest?.('[data-agent-ref]');
    if (!button || this.state.busy) return;
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

  handleRepositoryClick = async (event) => {
    const button = event.target?.closest?.('[data-repo-name]');
    if (!button || this.state.busy) return;
    const name = button.dataset.repoName || '';
    const enabled = button.dataset.enabled === 'true';
    this.setBusy(true);
    this.setStatus(`${enabled ? 'Disabling' : 'Enabling'} ${name}...`);
    try {
      this.state.marketplace = await this.requestMarketplace({
        action: enabled ? 'disable_repository' : 'enable_repository',
        name
      });
      this.setStatus(`${name} ${enabled ? 'disabled' : 'enabled'}.`);
    } catch (error) {
      this.setStatus(error?.message || 'Failed to update repository.', 'error');
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
    this.element.querySelector('.marketplace-repo-tools')?.classList.toggle('hidden', !canManage);
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

  renderRepositories() {
    if (!this.repositoriesEl) return;
    const repositories = this.state.marketplace?.repositories || [];
    if (!repositories.length) {
      this.repositoriesEl.innerHTML = '<div class="marketplace-empty">No repositories found.</div>';
      return;
    }
    this.repositoriesEl.replaceChildren(...repositories.map(repo => {
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
        ? `${activeAgentsCount} enabled agent${activeAgentsCount === 1 ? '' : 's'} remain active if this repo is disabled.`
        : '';
      const badges = document.createElement('div');
      badges.className = 'marketplace-badges';
      [repo.kind, repo.default ? 'default' : '', repo.installed ? 'installed' : '', repo.enabled ? 'enabled' : '']
        .filter(Boolean)
        .forEach(label => {
          const badge = document.createElement('span');
          badge.className = 'marketplace-badge';
          badge.textContent = label;
          badges.appendChild(badge);
        });
      info.append(title, description);
      if (note.textContent) info.append(note);
      info.append(badges);
      row.append(info);
      if (canManage) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = `marketplace-repo-toggle${repo.enabled ? ' active' : ''}`;
        toggle.dataset.repoName = repo.name;
        toggle.dataset.enabled = repo.enabled ? 'true' : 'false';
        toggle.disabled = this.state.busy;
        toggle.textContent = repo.enabled ? 'Disable' : 'Enable';
        row.append(toggle);
      }
      return row;
    }));
  }

  renderAgents() {
    if (!this.agentsEl) return;
    const agents = this.state.marketplace?.agents || [];
    if (!agents.length) {
      this.agentsEl.innerHTML = '<div class="marketplace-empty">No agents found.</div>';
      return;
    }
    this.agentsEl.replaceChildren(...agents.map(agent => {
      const canManage = this.canManageMarketplace();
      const row = document.createElement('article');
      row.className = 'marketplace-row';
      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'marketplace-title';
      const name = document.createElement('span');
      name.textContent = agent.ref;
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
      controls.append(modeSelect);

      if (canManage) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = `marketplace-agent-toggle${agent.active ? ' active' : ''}`;
        toggle.dataset.agentRef = agent.ref;
        toggle.dataset.active = agent.active ? 'true' : 'false';
        toggle.dataset.enableMode = currentMode;
        toggle.disabled = this.state.busy;
        toggle.textContent = agent.active ? 'Disable' : 'Enable';
        controls.append(toggle);
      }
      row.append(controls);
      return row;
    }));
  }
}
