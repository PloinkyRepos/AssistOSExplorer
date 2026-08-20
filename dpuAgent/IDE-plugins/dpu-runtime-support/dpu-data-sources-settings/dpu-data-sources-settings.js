const PROVIDERS = Object.freeze(['huggingface', 'edc']);

const PROVIDER_LABELS = Object.freeze({
    huggingface: 'Hugging Face',
    edc: 'EDC'
});

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function parseResult(value) {
    if (value?.json) return value.json;
    const text = value?.content?.find?.((item) => item.type === 'text')?.text;
    try { return text ? JSON.parse(text) : value; } catch { return null; }
}

async function callDpu(tool, args = {}) {
    const client = window.webSkel?.appServices?.getClient?.('dpuAgent');
    if (!client?.callTool) throw new Error('DPU agent is unavailable.');
    const result = parseResult(await client.callTool(tool, args));
    if (!result || result.ok === false) throw new Error(result?.error || result?.message || `Failed: ${tool}`);
    return result;
}

function normalizeProvider(provider) {
    const normalized = String(provider || '').trim().toLowerCase();
    return PROVIDERS.includes(normalized) ? normalized : '';
}

export function filterSourcesForProvider(sources = [], provider = '') {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider || !Array.isArray(sources)) return [];
    return sources.filter((source) => String(source?.type || '').trim().toLowerCase() === normalizedProvider);
}

export function providerForTabKey(currentProvider, key) {
    const currentIndex = PROVIDERS.indexOf(normalizeProvider(currentProvider));
    if (currentIndex < 0) return '';
    if (key === 'ArrowRight') return PROVIDERS[(currentIndex + 1) % PROVIDERS.length];
    if (key === 'ArrowLeft') return PROVIDERS[(currentIndex - 1 + PROVIDERS.length) % PROVIDERS.length];
    if (key === 'Home') return PROVIDERS[0];
    if (key === 'End') return PROVIDERS[PROVIDERS.length - 1];
    return '';
}

export function buildSourcePayload(provider, formValues = {}, existingSource = null) {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) throw new Error('Unsupported data source provider.');
    const payload = { ...formValues, type: normalizedProvider };
    if (!String(payload.id || '').trim()) delete payload.id;

    const providerSettings = normalizedProvider === 'edc'
        ? { ...(existingSource?.settings || {}) }
        : {};
    for (const name of ['counterPartyAddress', 'providerId', 'participantId']) {
        const value = String(payload[name] || '').trim();
        if (normalizedProvider === 'edc' && value) providerSettings[name] = value;
        else delete providerSettings[name];
        delete payload[name];
    }
    payload.settings = providerSettings;
    return payload;
}

function sourceState(source) {
    const state = String(source?.connectionState?.status || 'not tested').toLowerCase();
    if (['connected', 'available', 'ready', 'succeeded'].includes(state)) return { label: state, type: 'success' };
    if (['error', 'failed', 'blocked', 'unavailable'].includes(state)) return { label: state, type: 'error' };
    return { label: state, type: '' };
}

export class DpuDataSourcesSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.sources = [];
        this.secrets = [];
        this.activeProvider = 'huggingface';
        this.busy = false;
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.status = this.element.querySelector('#dpuSourcesStatus');
        this.tabList = this.element.querySelector('#dpuSourceTabs');
        this.fullscreenButton = this.element.querySelector('[data-source-fullscreen]');
        this.tabs = new Map(PROVIDERS.map((provider) => [
            provider,
            this.element.querySelector(`[data-source-tab="${provider}"]`)
        ]));
        this.panels = new Map(PROVIDERS.map((provider) => [
            provider,
            this.element.querySelector(`[data-source-panel="${provider}"]`)
        ]));
        this.lists = new Map(PROVIDERS.map((provider) => [
            provider,
            this.element.querySelector(`[data-source-list="${provider}"]`)
        ]));
        this.counts = new Map(PROVIDERS.map((provider) => [
            provider,
            this.element.querySelector(`[data-source-count="${provider}"]`)
        ]));
        this.forms = new Map(PROVIDERS.map((provider) => [
            provider,
            this.element.querySelector(`[data-source-form="${provider}"]`)
        ]));
        this.secretSelects = new Map(PROVIDERS.map((provider) => [
            provider,
            this.element.querySelector(`[data-source-secret="${provider}"]`)
        ]));
        this.addButtons = new Map(PROVIDERS.map((provider) => [
            provider,
            this.element.querySelector(`[data-source-add="${provider}"]`)
        ]));

        for (const [provider, form] of this.forms) {
            form?.addEventListener('submit', (event) => this.save(event, provider));
        }
        this.tabList?.addEventListener('keydown', (event) => this.handleTabKeydown(event));

        await Promise.all([...this.secretSelects.values()]
            .map((select) => select?.presenterReadyPromise)
            .filter(Boolean));
        this.updateTabUI();
        await this.refresh();
    }

    setStatus(message = '', type = '') {
        if (!this.status) return;
        this.status.textContent = message;
        for (const state of ['loading', 'success', 'error']) {
            this.status.classList.toggle(state, type === state);
        }
    }

    setBusy(value) {
        this.busy = Boolean(value);
        for (const list of this.lists.values()) {
            list?.setAttribute('aria-busy', this.busy ? 'true' : 'false');
        }
        for (const control of this.element.querySelectorAll('button, input')) {
            if (!control.matches('[data-window-control]')) control.disabled = this.busy;
        }
        for (const select of this.element.querySelectorAll('custom-select')) {
            select.toggleAttribute('disabled', this.busy);
            select.webSkelPresenter?.applyDisabledState?.();
        }
    }

    async setSelectOptions(select, options, selectedValue = '') {
        if (!select) return;
        await select.presenterReadyPromise;
        select.setAttribute('data-options', encodeURIComponent(JSON.stringify(options)));
        select.setAttribute('data-selected', selectedValue);
        select.webSkelPresenter?.setOptions?.(options, selectedValue);
        select.value = selectedValue;
    }

    async loadData() {
        const selectedSecrets = new Map([...this.secretSelects].map(([provider, select]) => [
            provider,
            select?.value || ''
        ]));
        const [sourceResult, secretResult] = await Promise.all([
            callDpu('dpu_source_list'),
            callDpu('dpu_secret_list')
        ]);
        this.sources = sourceResult.items || [];
        this.secrets = secretResult.secrets || [];
        const secretOptions = [
            { value: '', label: 'No credential' },
            ...this.secrets.map((secret) => ({
                value: secret.key,
                label: secret.displayName || secret.key
            }))
        ];
        await Promise.all([...this.secretSelects].map(([provider, select]) => {
            const selectedSecret = selectedSecrets.get(provider) || '';
            const nextSecret = secretOptions.some((option) => option.value === selectedSecret) ? selectedSecret : '';
            return this.setSelectOptions(select, secretOptions, nextSecret);
        }));
    }

    renderSources() {
        for (const provider of PROVIDERS) this.renderProviderSources(provider);
    }

    renderProviderSources(provider) {
        const list = this.lists.get(provider);
        if (!list) return;
        const sources = filterSourcesForProvider(this.sources, provider);
        const count = this.counts.get(provider);
        if (count) count.textContent = `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`;

        if (!sources.length) {
            const providerLabel = PROVIDER_LABELS[provider];
            list.innerHTML = `
                <div class="settings-empty-state">
                    No ${escapeHtml(providerLabel)} sources configured. Use Add source to configure this provider.
                </div>
            `;
            return;
        }

        list.innerHTML = sources.map((source) => {
            const state = sourceState(source);
            const capabilities = Array.isArray(source.capabilities) ? source.capabilities : [];
            const sourceId = escapeHtml(source.id);
            const metadata = [
                source.endpoint || (provider === 'huggingface' ? 'Default Hugging Face endpoint' : 'Endpoint not configured'),
                source.secretRef ? `Secret: ${source.secretRef}` : 'No credential'
            ];
            return `
                <article class="settings-card dpu-source-card">
                    <div class="settings-card-info">
                        <div class="dpu-source-card-main">
                            <div>
                                <div class="settings-card-title">${escapeHtml(source.name)}</div>
                                <div class="settings-card-meta">${metadata.map(escapeHtml).join(' · ')}</div>
                            </div>
                            <span class="status-badge ${state.type}">${escapeHtml(state.label)}</span>
                        </div>
                        <div class="dpu-source-capabilities" aria-label="Capabilities">
                            ${capabilities.length
                                ? capabilities.map((capability) => `<span class="settings-chip">${escapeHtml(capability)}</span>`).join('')
                                : '<span class="settings-card-meta">No capabilities reported</span>'}
                        </div>
                    </div>
                    <div class="settings-card-actions" aria-label="Source actions">
                        <button type="button" class="general-button secondary" data-local-action="editSource ${sourceId}">Edit</button>
                        <button type="button" class="general-button secondary" data-local-action="testSource ${sourceId}">Test connection</button>
                        <button type="button" class="general-button secondary" data-local-action="toggleSource ${sourceId}">${source.enabled ? 'Disable' : 'Enable'}</button>
                        <button type="button" class="gray-button" data-local-action="removeSource ${sourceId}">Remove</button>
                    </div>
                </article>
            `;
        }).join('');
    }

    updateTabUI() {
        for (const provider of PROVIDERS) {
            const active = provider === this.activeProvider;
            const tab = this.tabs.get(provider);
            const panel = this.panels.get(provider);
            tab?.classList.toggle('active', active);
            tab?.setAttribute('aria-selected', active ? 'true' : 'false');
            tab?.setAttribute('tabindex', active ? '0' : '-1');
            if (panel) panel.hidden = !active;
        }
    }

    switchTab(_target, provider) {
        const normalizedProvider = normalizeProvider(provider);
        if (!normalizedProvider || this.busy) return;
        this.activeProvider = normalizedProvider;
        this.updateTabUI();
    }

    handleTabKeydown(event) {
        const currentTab = event.target?.closest?.('[data-source-tab]');
        if (!currentTab || !this.tabList?.contains(currentTab) || this.busy) return;
        const provider = providerForTabKey(currentTab.dataset.sourceTab, event.key);
        if (!provider) return;
        event.preventDefault();
        this.switchTab(null, provider);
        this.tabs.get(provider)?.focus();
    }

    setFormOpen(provider, open) {
        const form = this.forms.get(provider);
        const addButton = this.addButtons.get(provider);
        if (form) form.hidden = !open;
        addButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    resetForm(provider, { close = true } = {}) {
        const form = this.forms.get(provider);
        if (!form) return;
        form.reset();
        if (form.elements.id) form.elements.id.value = '';
        const secretSelect = this.secretSelects.get(provider);
        if (secretSelect) secretSelect.value = '';
        const title = form.querySelector('[data-source-editor-title]');
        const submitButton = form.querySelector('[type="submit"]');
        if (title) title.textContent = `Add ${PROVIDER_LABELS[provider]} source`;
        if (submitButton) submitButton.textContent = 'Add source';
        if (close) this.setFormOpen(provider, false);
    }

    addSource(_target, provider) {
        const normalizedProvider = normalizeProvider(provider);
        if (!normalizedProvider || this.busy) return;
        this.activeProvider = normalizedProvider;
        this.updateTabUI();
        this.resetForm(normalizedProvider, { close: false });
        this.setFormOpen(normalizedProvider, true);
        const form = this.forms.get(normalizedProvider);
        form?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        form?.elements.name?.focus();
    }

    cancelEdit(_target, provider) {
        const normalizedProvider = normalizeProvider(provider);
        if (!normalizedProvider || this.busy) return;
        this.resetForm(normalizedProvider);
        this.addButtons.get(normalizedProvider)?.focus();
    }

    editSource(_target, id) {
        if (this.busy) return;
        const source = this.sources.find((item) => item.id === id);
        const provider = normalizeProvider(source?.type);
        const form = this.forms.get(provider);
        if (!source || !provider || !form) return;
        this.activeProvider = provider;
        this.updateTabUI();
        this.resetForm(provider, { close: false });
        for (const name of ['id', 'name', 'endpoint']) {
            if (form.elements[name]) form.elements[name].value = source[name] || '';
        }
        const secretSelect = this.secretSelects.get(provider);
        if (secretSelect) secretSelect.value = source.secretRef || '';
        if (provider === 'edc') {
            for (const name of ['counterPartyAddress', 'providerId', 'participantId']) {
                if (form.elements[name]) form.elements[name].value = source.settings?.[name] || '';
            }
        }
        const title = form.querySelector('[data-source-editor-title]');
        const submitButton = form.querySelector('[type="submit"]');
        if (title) title.textContent = `Edit ${source.name}`;
        if (submitButton) submitButton.textContent = 'Save changes';
        this.setFormOpen(provider, true);
        form.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        form.elements.name?.focus();
    }

    async save(event, provider) {
        event.preventDefault();
        const form = this.forms.get(provider);
        if (this.busy || !form?.reportValidity()) return;
        const values = Object.fromEntries(new FormData(form));
        const existingSource = values.id ? this.sources.find((source) => source.id === values.id) : null;
        const payload = buildSourcePayload(provider, values, existingSource);
        this.setBusy(true);
        this.setStatus(`Saving ${PROVIDER_LABELS[provider]} source…`, 'loading');
        try {
            await callDpu('dpu_source_upsert', payload);
            this.resetForm(provider);
            await this.loadData();
            this.renderSources();
            this.setStatus(`${PROVIDER_LABELS[provider]} source saved.`, 'success');
        } catch (error) {
            this.setStatus(error?.message || 'Failed to save data source.', 'error');
        } finally {
            this.setBusy(false);
        }
    }

    async refresh({ showProgress = true } = {}) {
        if (this.busy && showProgress) return;
        if (showProgress) {
            this.setBusy(true);
            this.setStatus('Loading data sources…', 'loading');
        }
        try {
            await this.loadData();
            this.renderSources();
            if (showProgress) this.setStatus('');
        } catch (error) {
            this.setStatus(error?.message || 'Failed to load data sources.', 'error');
        } finally {
            if (showProgress) this.setBusy(false);
        }
    }

    async refreshSources() {
        await this.refresh();
    }

    async runSourceAction(id, progressMessage, successMessage, action) {
        if (this.busy) return false;
        const source = this.sources.find((item) => item.id === id);
        if (!source) return false;
        this.setBusy(true);
        this.setStatus(progressMessage(source), 'loading');
        try {
            await action(source);
            await this.loadData();
            this.renderSources();
            this.setStatus(successMessage(source), 'success');
            return true;
        } catch (error) {
            await this.loadData().catch(() => {});
            this.renderSources();
            this.setStatus(error?.message || 'The source operation failed.', 'error');
            return false;
        } finally {
            this.setBusy(false);
        }
    }

    async testSource(_target, id) {
        await this.runSourceAction(
            id,
            (source) => `Testing ${source.name}…`,
            (source) => `Connection to ${source.name} was tested.`,
            (source) => callDpu('dpu_source_test', { id: source.id })
        );
    }

    async toggleSource(_target, id) {
        await this.runSourceAction(
            id,
            (source) => `${source.enabled ? 'Disabling' : 'Enabling'} ${source.name}…`,
            (source) => `${source.name} is now ${source.enabled ? 'disabled' : 'enabled'}.`,
            (source) => callDpu('dpu_source_set_enabled', { id: source.id, enabled: !source.enabled })
        );
    }

    async removeSource(_target, id) {
        const source = this.sources.find((item) => item.id === id);
        if (!source || this.busy) return;
        const confirmed = await assistOS.UI.showModal('confirm-action-modal', {
            message: `Remove ${source.name}? This removes only the source configuration; its DPU Secret is not deleted.`
        }, true);
        if (!confirmed) return;
        const removed = await this.runSourceAction(
            id,
            (item) => `Removing ${item.name}…`,
            (item) => `${item.name} was removed.`,
            (item) => callDpu('dpu_source_remove', { id: item.id })
        );
        const provider = normalizeProvider(source.type);
        const form = this.forms.get(provider);
        if (removed && form?.elements.id?.value === id) this.resetForm(provider);
    }

    toggleFullscreen() {
        const dialog = this.element.closest('dialog');
        if (!dialog) return;
        const isFullscreen = !dialog.classList.contains('is-fullscreen');
        dialog.classList.toggle('is-fullscreen', isFullscreen);
        this.fullscreenButton?.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
    }

    closeModal() {
        assistOS.UI.closeModal(this.element);
    }
}
