import {
    getKeymap,
    setKeymap,
    getDefaultKeymap,
    getKeymapActions,
    eventToShortcut,
    formatShortcutForDisplay,
    normalizeShortcutString
} from "../../../utils/keymap.js";
import { getCurrentTheme, setTheme } from "../../../utils/theme.js";
import {
    callExplorerTool,
    parseToolResult
} from "../../../services/infrastructure/explorerApi.js";
import {
    compareRuntimePluginEntries,
    forEachRuntimePluginEntry,
    getRuntimePluginOrder,
    getRuntimePluginPolicyKey
} from "../../../utils/pluginUtils.core.js";
import { registerRuntimeComponent } from "../../../utils/pluginUtils.ui.js";
import {
    ensureAxiFaceLoaded,
    getCurrentProfileAvatar,
    normalizeAvatarConfig,
    renderAxiFaceMarkup,
    saveCurrentProfileAvatar
} from "../../../services/profile-avatar-client.js";

const settingsComponentPromises = new Map();
const BASE_TABS = ['keymap', 'editor', 'theme', 'plugins', 'copilot', 'avatar'];
const AVATAR_FIELD_DEFS = Object.freeze([
    { key: 'generated', label: 'Generated', type: 'checkbox' },
    { key: 'src', label: 'SVG source', type: 'text' },
    { key: 'packSrc', label: 'Pack manifest', type: 'text' },
    { key: 'assetMode', label: 'Asset mode', type: 'select', options: ['img', 'inline'] },
    { key: 'style', label: 'Style', type: 'select', options: ['robot-soft', 'robot-minimal', 'sketch', 'emoji', 'terminal'] },
    { key: 'palette', label: 'Palette', type: 'text' },
    { key: 'complexity', label: 'Complexity', type: 'select', options: ['', 'low', 'medium', 'high'] },
    { key: 'emotion', label: 'Emotion', type: 'select', options: ['neutral', 'idle', 'listening', 'thinking', 'speaking', 'happy', 'amused', 'confused', 'concerned', 'alert', 'sleepy'] },
    { key: 'shape', label: 'Shape', type: 'select', options: ['circle', 'square', 'rounded', 'none'] },
    { key: 'theme', label: 'Theme', type: 'select', options: ['auto', 'light', 'dark'] },
    { key: 'thoughtMode', label: 'Thought mode', type: 'select', options: ['none', 'bubble', 'caption', 'ticker', 'inside'] },
    { key: 'thought', label: 'Thought', type: 'text' },
    { key: 'seed', label: 'Seed', type: 'text' },
    { key: 'size', label: 'Size', type: 'text' },
    { key: 'animated', label: 'Animated', type: 'checkbox' },
    { key: 'listen', label: 'Listen', type: 'checkbox' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['static', 'controlled', 'event-driven', 'autonomous'] }
]);

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getCurrentAgentName() {
    try {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return parts[0] || 'explorer';
    } catch (_) {
        return 'explorer';
    }
}

function defaultAvatarConfig(id, size = '72') {
    return {
        agentId: id,
        generated: true,
        src: '',
        packSrc: '',
        assetMode: 'img',
        emotion: 'neutral',
        size,
        thought: '',
        thoughtMode: 'none',
        mode: 'static',
        shape: 'circle',
        theme: 'auto',
        animated: true,
        listen: false,
        seed: id,
        style: 'robot-soft',
        palette: 'default',
        complexity: ''
    };
}

function normalizePathSegment(value) {
    return String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/g, "")
        .replace(/\/+/g, "/");
}

function toPascalCase(value) {
    return String(value || "")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join("");
}

function resolveSettingsComponentBase(item) {
    const settingsComponent = typeof item?.settingsComponent === "string" ? item.settingsComponent.trim() : "";
    if (!settingsComponent) {
        return "";
    }

    const normalizedSettings = normalizePathSegment(settingsComponent);
    const assetRootPath = normalizePathSegment(item?.assetRootPath);
    if (assetRootPath) {
        return `/workspace-files/${assetRootPath}/${normalizedSettings}/${normalizedSettings}`;
    }

    const agent = typeof item?.agent === "string" ? item.agent.trim() : "";
    const component = typeof item?.component === "string" ? item.component.trim() : "";
    if (!agent || !component) {
        return "";
    }

    return `/${agent}/IDE-plugins/${component}/${normalizedSettings}/${normalizedSettings}`;
}

async function fetchText(url, description) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`${description} (${response.status})`);
    }
    return response.text();
}

async function ensureSettingsComponentRegistered(item) {
    const componentName = typeof item?.settingsComponent === "string" ? item.settingsComponent.trim() : "";
    if (!componentName) {
        throw new Error("Plugin does not define a settings component.");
    }

    if (customElements.get(componentName)) {
        return componentName;
    }

    if (settingsComponentPromises.has(componentName)) {
        return settingsComponentPromises.get(componentName);
    }

    const promise = (async () => {
        const baseUrl = resolveSettingsComponentBase(item);
        if (!baseUrl) {
            throw new Error(`Unable to resolve settings component path for ${componentName}.`);
        }

        const [template, css] = await Promise.all([
            fetchText(`${baseUrl}.html`, `Failed to load settings template for ${componentName}`),
            fetchText(`${baseUrl}.css`, `Failed to load settings stylesheet for ${componentName}`)
        ]);

        const module = await import(`${baseUrl}.js?cacheBust=${Date.now()}`);
        const presenterClassName = Object.keys(module || {}).find((key) => typeof module[key] === "function")
            || `${toPascalCase(componentName)}Settings`;

        await registerRuntimeComponent(assistOS.webSkel, {
            name: componentName,
            componentType: "modals",
            loadedTemplate: template,
            loadedCSSs: [css],
            presenterClassName,
            presenterModule: module,
            type: "modals"
        });

        return componentName;
    })().finally(() => {
        settingsComponentPromises.delete(componentName);
    });

    settingsComponentPromises.set(componentName, promise);
    return promise;
}

function normalizeSettingsMap(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    const plugins = parsed.plugins;
    if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
        return {};
    }
    return plugins;
}

function flattenPluginsByKey(pluginBuckets) {
    const items = new Map();
    forEachRuntimePluginEntry(pluginBuckets, (plugin, { category, location }) => {
        const agent = typeof plugin?.agent === "string" && plugin.agent.trim() ? plugin.agent.trim() : "unknown";
        const component = typeof plugin?.component === "string" && plugin.component.trim() ? plugin.component.trim() : "";
        const pluginId = typeof plugin?.id === "string" && plugin.id.trim() ? plugin.id.trim() : "";
        const key = getRuntimePluginPolicyKey(plugin);
        if (!key) return;
        const existing = items.get(key) || {
            key,
            agent,
            component,
            pluginId,
            label: "",
            tooltip: "",
            pluginCategory: category,
            contributionTypes: new Set(),
            locations: [],
            locationOrder: getRuntimePluginOrder(plugin),
            settingsComponent: "",
            assetRootPath: "",
            adminOnly: false
        };
        existing.pluginCategory = plugin?.pluginCategory || existing.pluginCategory || category;
        if (plugin?.adminOnly === true) existing.adminOnly = true;
        const contributionType = typeof plugin?.contributionType === "string" && plugin.contributionType.trim()
            ? plugin.contributionType.trim()
            : (category === "application" ? "mount" : "document");
        existing.contributionTypes.add(contributionType);
        existing.locationOrder = Math.min(existing.locationOrder, getRuntimePluginOrder(plugin));
        existing.label = typeof plugin?.label === "string" && plugin.label.trim()
            ? plugin.label.trim()
            : existing.label || pluginId || component;
        existing.tooltip = typeof plugin?.tooltip === "string" && plugin.tooltip.trim()
            ? plugin.tooltip.trim()
            : existing.tooltip || existing.label;
        existing.pluginId = pluginId || existing.pluginId || "";
        existing.component = component || existing.component || "";
        existing.settingsComponent = typeof plugin?.settings === "string" && plugin.settings.trim()
            ? plugin.settings.trim()
            : existing.settingsComponent;
        existing.assetRootPath = typeof plugin?.assetRootPath === "string" && plugin.assetRootPath.trim()
            ? plugin.assetRootPath.trim()
            : existing.assetRootPath;
        if (!existing.locations.includes(location)) {
            existing.locations.push(location);
        }
        items.set(key, existing);
    });
    return Array.from(items.values())
        .map((item) => ({
            ...item,
            contributionTypes: Array.from(item.contributionTypes.values()).sort(),
            locations: [...item.locations].sort()
        }))
        .sort((a, b) => compareRuntimePluginEntries(a, b));
}

function getCachedRuntimePlugins() {
    const assist = typeof window !== "undefined" ? window.assistOS : null;
    const rawPlugins = assist?.rawRuntimePlugins;
    if (rawPlugins && typeof rawPlugins === "object" && !Array.isArray(rawPlugins)) {
        return rawPlugins;
    }
    const runtimePlugins = assist?.runtimePlugins;
    if (runtimePlugins && typeof runtimePlugins === "object" && !Array.isArray(runtimePlugins)) {
        return runtimePlugins;
    }
    return null;
}

export class SettingsModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        const initialTab = [...BASE_TABS, 'users'].includes(this.props.tab) ? this.props.tab : 'keymap';
        this.state = {
            activeTab: initialTab,
            selectedTheme: this.props.theme === "dark" ? "dark" : getCurrentTheme(),
            keymap: { ...(this.props.keymap || getKeymap()) },
            editorAutoSaveEnabled: Boolean(this.props.editorAutoSaveEnabled),
            editorAutoSaveIntervalSeconds: Number.isFinite(this.props.editorAutoSaveIntervalSeconds)
                ? Math.max(1, Math.round(this.props.editorAutoSaveIntervalSeconds))
                : 10,
            hasConflicts: false,
            pluginItems: [],
            pluginSettings: {},
            pluginBusyActionKey: "",
            pluginStatus: "",
            pluginStatusType: "",
            pluginDataLoaded: false,
            copilotItems: [],
            copilotDisabledKeys: new Set(),
            copilotStatus: "",
            copilotStatusType: "",
            copilotDataLoaded: false,
            avatarDataLoaded: false,
            avatarStatus: "",
            avatarStatusType: "",
            avatarBusy: false,
            avatarUser: null,
            profileAvatar: defaultAvatarConfig('profile:current-user', '72'),
            profileAvatarEnabled: true,
            profileAvatarSource: null,
            dpuProfileAvailable: true,
            agentAvatarItems: [],
            selectedAvatarAgentId: "",
            selectedAgentAvatar: defaultAvatarConfig('agent', '72'),
            selectedAgentAvatarEnabled: true,
            canManageAgentAvatars: false,
            usersAccessChecked: false,
            usersAccess: false,
            usersUrl: ""
        };
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.cacheElements();
        this.updateTabUI();
        this.renderRows();
        this.renderPluginSettings();
        this.updateThemeSelection();
        this.bindEvents();
        this.refreshUsersAccess();
        if (this.state.activeTab === "plugins" && !this.state.pluginDataLoaded) {
            await this.loadPluginSettingsData();
        }
        if (this.state.activeTab === "copilot" && !this.state.copilotDataLoaded) {
            await this.loadCopilotSettingsData();
        }
        if (this.state.activeTab === "avatar" && !this.state.avatarDataLoaded) {
            await this.loadAvatarSettingsData();
        }
    }

    cacheElements() {
        this.keymapSection = this.element.querySelector('[data-section="keymap"]');
        this.editorSection = this.element.querySelector('[data-section="editor"]');
        this.themeSection = this.element.querySelector('[data-section="theme"]');
        this.pluginsSection = this.element.querySelector('[data-section="plugins"]');
        this.copilotSection = this.element.querySelector('[data-section="copilot"]');
        this.avatarSection = this.element.querySelector('[data-section="avatar"]');
        this.usersSection = this.element.querySelector('[data-section="users"]');
        this.usersTab = this.element.querySelector('[data-admin-tab]');
        this.usersFrame = this.element.querySelector('#usersSettingsFrame');
        this.listEl = this.element.querySelector("#keymapList");
        this.warningEl = this.element.querySelector("#keymapWarning");
        this.pluginSettingsListEl = this.element.querySelector("#pluginSettingsList");
        this.pluginSettingsStatusEl = this.element.querySelector("#pluginSettingsStatus");
        this.copilotSettingsListEl = this.element.querySelector("#copilotSettingsList");
        this.copilotSettingsStatusEl = this.element.querySelector("#copilotSettingsStatus");
        this.avatarSettingsStatusEl = this.element.querySelector("#avatarSettingsStatus");
        this.profileAvatarPreviewEl = this.element.querySelector("#profileAvatarPreview");
        this.agentAvatarPreviewEl = this.element.querySelector("#agentAvatarPreview");
        this.profileAvatarControlsEl = this.element.querySelector('[data-avatar-scope="profile"]');
        this.agentAvatarControlsEl = this.element.querySelector('[data-avatar-scope="agent"]');
        this.agentAvatarCardEl = this.element.querySelector("#agentAvatarCard");
        this.avatarAgentListEl = this.element.querySelector("#avatarAgentList");
        this.profileAvatarEnabledInput = this.element.querySelector("#profileAvatarEnabled");
        this.agentAvatarEnabledInput = this.element.querySelector("#agentAvatarEnabled");
        this.saveProfileAvatarButton = this.element.querySelector("#saveProfileAvatarButton");
        this.saveAgentAvatarButton = this.element.querySelector("#saveAgentAvatarButton");
        this.editorAutoSaveEnabledInput = this.element.querySelector('#editorAutoSaveEnabled');
        this.editorAutoSaveIntervalInput = this.element.querySelector('#editorAutoSaveIntervalSeconds');
        this.actionsEl = this.element.querySelector('.modal-actions');
        this.saveButton = this.element.querySelector('[data-local-action="saveSettings"]');
        this.resetButton = this.element.querySelector('[data-role="reset-keymap"]');
    }

    bindEvents() {
        if (!this.element.dataset.boundSettingsModal) {
            this.element.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.closeModal();
                }
            });
            this.element.dataset.boundSettingsModal = "true";
        }
        if (this.editorAutoSaveEnabledInput && !this.editorAutoSaveEnabledInput.dataset.bound) {
            this.editorAutoSaveEnabledInput.addEventListener('change', () => this.handleEditorAutoSaveToggle());
            this.editorAutoSaveEnabledInput.dataset.bound = 'true';
        }
        if (this.editorAutoSaveIntervalInput && !this.editorAutoSaveIntervalInput.dataset.bound) {
            this.editorAutoSaveIntervalInput.addEventListener('input', () => this.handleEditorAutoSaveIntervalInput());
            this.editorAutoSaveIntervalInput.dataset.bound = 'true';
        }
        if (this.profileAvatarControlsEl && !this.profileAvatarControlsEl.dataset.bound) {
            this.profileAvatarControlsEl.addEventListener('input', () => this.handleAvatarControlsInput('profile'));
            this.profileAvatarControlsEl.addEventListener('change', () => this.handleAvatarControlsInput('profile'));
            this.profileAvatarControlsEl.dataset.bound = 'true';
        }
        if (this.agentAvatarControlsEl && !this.agentAvatarControlsEl.dataset.bound) {
            this.agentAvatarControlsEl.addEventListener('input', () => this.handleAvatarControlsInput('agent'));
            this.agentAvatarControlsEl.addEventListener('change', () => this.handleAvatarControlsInput('agent'));
            this.agentAvatarControlsEl.dataset.bound = 'true';
        }
        if (this.agentAvatarEnabledInput && !this.agentAvatarEnabledInput.dataset.bound) {
            this.agentAvatarEnabledInput.addEventListener('change', () => {
                this.state.selectedAgentAvatarEnabled = Boolean(this.agentAvatarEnabledInput.checked);
            });
            this.agentAvatarEnabledInput.dataset.bound = 'true';
        }
        if (this.profileAvatarEnabledInput && !this.profileAvatarEnabledInput.dataset.bound) {
            this.profileAvatarEnabledInput.addEventListener('change', () => {
                this.state.profileAvatarEnabled = Boolean(this.profileAvatarEnabledInput.checked);
                this.renderAvatarPreviews();
            });
            this.profileAvatarEnabledInput.dataset.bound = 'true';
        }
    }

    switchTab(_target, tab) {
        const allowedTabs = this.getAllowedTabs();
        this.state.activeTab = allowedTabs.includes(tab) ? tab : 'keymap';
        this.updateTabUI();
        if (this.state.activeTab === "plugins" && !this.state.pluginDataLoaded) {
            this.loadPluginSettingsData().catch((error) => {
                this.state.pluginStatus = error?.message || "Failed to load plugin settings.";
                this.state.pluginStatusType = "error";
                this.renderPluginSettingsStatus();
            });
        }
        if (this.state.activeTab === "copilot" && !this.state.copilotDataLoaded) {
            this.loadCopilotSettingsData().catch((error) => {
                this.state.copilotStatus = error?.message || "Failed to load Copilot skills.";
                this.state.copilotStatusType = "error";
                this.renderCopilotSettingsStatus();
            });
        }
        if (this.state.activeTab === "avatar") {
            this.state.avatarDataLoaded = false;
            this.loadAvatarSettingsData().catch((error) => {
                this.state.avatarStatus = error?.message || "Failed to load avatar settings.";
                this.state.avatarStatusType = "error";
                this.renderAvatarSettings();
            });
        }
        if (this.state.activeTab === "users") {
            this.syncUsersFrame();
        }
    }

    getAllowedTabs() {
        return this.state.usersAccess ? [...BASE_TABS, 'users'] : BASE_TABS;
    }

    updateTabUI() {
        if (!this.getAllowedTabs().includes(this.state.activeTab)) {
            this.state.activeTab = 'keymap';
        }
        this.element.dataset.activeTab = this.state.activeTab;
        const tabs = this.element.querySelectorAll(".settings-tab");
        tabs.forEach((tab) => {
            const isActive = tab.dataset.tab === this.state.activeTab;
            tab.classList.toggle("active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        if (this.usersTab) {
            this.usersTab.hidden = !this.state.usersAccess;
        }

        const sections = [
            { key: 'keymap', element: this.keymapSection },
            { key: 'editor', element: this.editorSection },
            { key: 'theme', element: this.themeSection },
            { key: 'plugins', element: this.pluginsSection },
            { key: 'copilot', element: this.copilotSection },
            { key: 'avatar', element: this.avatarSection },
            { key: 'users', element: this.usersSection }
        ];
        sections.forEach(({ key, element }) => {
            if (!element) return;
            element.classList.toggle('hidden', key !== this.state.activeTab);
        });

        if (this.resetButton) {
            this.resetButton.style.display = this.state.activeTab === "keymap" ? "" : "none";
        }
        if (this.actionsEl) {
            this.actionsEl.hidden = this.state.activeTab === "users" || this.state.activeTab === "avatar";
        }
        this.syncEditorSettingsUi();
        this.syncUsersFrame();
    }

    async refreshUsersAccess() {
        if (this.state.usersAccessChecked) return;
        this.state.usersAccessChecked = true;
        const agentName = getCurrentAgentName();
        this.state.usersUrl = `/${encodeURIComponent(agentName)}/admin/settings.html?embedded=1`;
        try {
            const response = await fetch(`/api/agents/${encodeURIComponent(agentName)}/users`, {
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            this.state.usersAccess = response.ok;
        } catch (_) {
            this.state.usersAccess = false;
        }
        this.updateTabUI();
    }

    syncUsersFrame() {
        if (!this.usersFrame) return;
        if (!this.state.usersAccess || this.state.activeTab !== "users") {
            return;
        }
        if (this.usersFrame.getAttribute("src") !== this.state.usersUrl) {
            this.usersFrame.setAttribute("src", this.state.usersUrl);
        }
    }

    renderPluginSettings() {
        this.renderPluginSettingsStatus();
        this.renderPluginSettingsList();
    }

    renderCopilotSettings() {
        this.renderCopilotSettingsStatus();
        this.renderCopilotSettingsList();
    }

    renderPluginSettingsStatus() {
        if (!this.pluginSettingsStatusEl) return;
        this.pluginSettingsStatusEl.textContent = this.state.pluginStatus || "";
        this.pluginSettingsStatusEl.classList.toggle("error", this.state.pluginStatusType === "error");
    }

    renderCopilotSettingsStatus() {
        if (!this.copilotSettingsStatusEl) return;
        this.copilotSettingsStatusEl.textContent = this.state.copilotStatus || "";
        this.copilotSettingsStatusEl.classList.toggle("error", this.state.copilotStatusType === "error");
    }

    renderPluginSettingsList() {
        if (!this.pluginSettingsListEl) return;
        if (!this.state.pluginItems.length) {
            this.pluginSettingsListEl.innerHTML = `<div class="plugin-settings-empty">No plugins discovered for this workspace.</div>`;
            return;
        }
        const visibleItems = this.state.usersAccess
            ? this.state.pluginItems
            : this.state.pluginItems.filter((item) => !item.adminOnly);
        this.pluginSettingsListEl.innerHTML = visibleItems.map((item) => {
            const enabled = this.isPluginEnabled(item.key);
            const busyToggle = this.state.pluginBusyActionKey === `${item.key}::toggle`;
            const busySettings = this.state.pluginBusyActionKey === `${item.key}::settings`;
            const locations = item.locations.filter(Boolean).join(", ") || "(hidden)";
            const contributionTypes = Array.isArray(item.contributionTypes) ? item.contributionTypes.join(", ") : "";
            const hasSettings = Boolean(item.settingsComponent);
            return `
                <div class="plugin-settings-row">
                    <div class="plugin-settings-info">
                        <div class="plugin-settings-key">${item.label || item.component}</div>
                        <div class="plugin-settings-meta">${item.key} · Category: ${item.pluginCategory} · Types: ${contributionTypes} · Locations: ${locations}</div>
                    </div>
                    <div class="plugin-settings-actions">
                        ${hasSettings ? `
                            <button
                                type="button"
                                class="plugin-settings-open"
                                data-local-action="openPluginSettings ${item.key}"
                                ${busySettings ? "disabled" : ""}
                            >
                                Settings
                            </button>
                        ` : ""}
                        <button
                            type="button"
                            class="plugin-settings-toggle ${enabled ? "enabled" : ""}"
                            data-local-action="togglePlugin ${item.key}"
                            ${busyToggle ? "disabled" : ""}
                        >
                            ${enabled ? "Enabled" : "Disabled"}
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    }

    renderCopilotSettingsList() {
        if (!this.copilotSettingsListEl) return;
        if (!this.state.copilotItems.length) {
            this.copilotSettingsListEl.innerHTML = `<div class="plugin-settings-empty">No Copilot skills discovered for this workspace.</div>`;
            return;
        }
        this.copilotSettingsListEl.innerHTML = this.state.copilotItems.map((item) => {
            const enabled = !this.state.copilotDisabledKeys.has(item.key);
            return `
                <div class="plugin-settings-row">
                    <div class="plugin-settings-info">
                        <div class="plugin-settings-key">${item.name}</div>
                        <div class="plugin-settings-meta">${item.key} · Type: ${item.type || 'unknown'}${item.isInternal ? ' · Internal' : ''}</div>
                    </div>
                    <div class="plugin-settings-actions">
                        <button
                            type="button"
                            class="plugin-settings-toggle ${enabled ? "enabled" : ""}"
                            data-local-action="toggleCopilotSkill ${item.key}"
                        >
                            ${enabled ? "Enabled" : "Disabled"}
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    }

    isPluginEnabled(key) {
        const entry = this.state.pluginSettings[key];
        if (!entry || typeof entry !== "object") {
            return true;
        }
        return entry.enabled !== false;
    }

    async loadPluginSettingsData() {
        this.state.pluginStatus = "Loading plugins...";
        this.state.pluginStatusType = "";
        this.renderPluginSettingsStatus();
        try {
            let pluginsByLocation = getCachedRuntimePlugins();
            if (!pluginsByLocation) {
                const pluginsPayload = await callExplorerTool("collect_ide_plugins", {}, { raw: true, withLoader: false });
                pluginsByLocation = parseToolResult(pluginsPayload) || {};
            }
            const settingsPayload = await callExplorerTool("get_plugin_settings", {}, { raw: true, withLoader: false });
            const settings = normalizeSettingsMap(parseToolResult(settingsPayload));
            this.state.pluginItems = flattenPluginsByKey(pluginsByLocation);
            this.state.pluginSettings = settings;
            this.state.pluginDataLoaded = true;
            if (window.assistOS) {
                window.assistOS.pluginSettings = settings;
            }
            this.state.pluginStatus = this.state.pluginItems.length
                ? `${this.state.pluginItems.length} plugins loaded.`
                : "No plugins discovered.";
            this.state.pluginStatusType = "";
            this.renderPluginSettings();
        } catch (error) {
            this.state.pluginStatus = error?.message || "Failed to load plugin settings.";
            this.state.pluginStatusType = "error";
            this.renderPluginSettingsStatus();
        }
    }

    async loadCopilotSettingsData() {
        this.state.copilotStatus = "Loading Copilot skills...";
        this.state.copilotStatusType = "";
        this.renderCopilotSettingsStatus();
        try {
            const payload = await callExplorerTool("list-skills", {}, { raw: true, withLoader: false });
            const parsed = parseToolResult(payload) || {};
            const items = Array.isArray(parsed.skills) ? parsed.skills : [];
            this.state.copilotItems = items
                .map((entry) => ({
                    key: String(entry?.key || "").trim().toLowerCase(),
                    name: String(entry?.name || "").trim(),
                    type: String(entry?.type || "").trim(),
                    isInternal: Boolean(entry?.isInternal),
                }))
                .filter((entry) => entry.key && entry.name)
                .sort((left, right) => left.name.localeCompare(right.name));
            this.state.copilotDisabledKeys = new Set();
            this.state.copilotDataLoaded = true;
            this.state.copilotStatus = this.state.copilotItems.length
                ? `${this.state.copilotItems.length} skills loaded. Toggle state is local only.`
                : "No Copilot skills discovered.";
            this.state.copilotStatusType = "";
            this.renderCopilotSettings();
        } catch (error) {
            this.state.copilotStatus = error?.message || "Failed to load Copilot skills.";
            this.state.copilotStatusType = "error";
            this.renderCopilotSettingsStatus();
        }
    }

    toggleCopilotSkill(_target, key) {
        const normalizedKey = String(key || "").trim().toLowerCase();
        if (!normalizedKey) return;
        if (this.state.copilotDisabledKeys.has(normalizedKey)) {
            this.state.copilotDisabledKeys.delete(normalizedKey);
        } else {
            this.state.copilotDisabledKeys.add(normalizedKey);
        }
        this.state.copilotStatus = "Toggle state is local only and is not saved.";
        this.state.copilotStatusType = "";
        this.renderCopilotSettings();
    }

    async togglePlugin(_target, key) {
        if (!key) return;
        const nextEnabled = !this.isPluginEnabled(key);
        this.state.pluginBusyActionKey = `${key}::toggle`;
        this.state.pluginStatus = `Saving ${key}...`;
        this.state.pluginStatusType = "";
        this.renderPluginSettings();
        try {
            const payload = await callExplorerTool("set_plugin_enabled", {
                key,
                enabled: nextEnabled
            }, { raw: true, withLoader: false });
            const parsed = parseToolResult(payload) || {};
            this.state.pluginSettings = normalizeSettingsMap(parsed.settings || { plugins: this.state.pluginSettings });
            if (window.assistOS) {
                window.assistOS.pluginSettings = this.state.pluginSettings;
            }
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("assistos:plugin-settings-updated", {
                    detail: { settings: this.state.pluginSettings }
                }));
            }
            this.state.pluginStatus = `${key} ${nextEnabled ? "enabled" : "disabled"} in workspace settings.`;
            this.state.pluginStatusType = "";
        } catch (error) {
            this.state.pluginStatus = error?.message || `Failed to update ${key}.`;
            this.state.pluginStatusType = "error";
        } finally {
            this.state.pluginBusyActionKey = "";
            this.renderPluginSettings();
        }
    }

    async openPluginSettings(_target, key) {
        if (!key) return;
        const item = this.state.pluginItems.find((entry) => entry?.key === key);
        if (!item || !item.settingsComponent) {
            return;
        }

        this.state.pluginBusyActionKey = `${key}::settings`;
        this.state.pluginStatus = `Opening settings for ${key}...`;
        this.state.pluginStatusType = "";
        this.renderPluginSettings();

        try {
            await ensureSettingsComponentRegistered(item);
            await assistOS.UI.createReactiveModal(item.settingsComponent, {
                plugin: {
                    key: item.key,
                    agent: item.agent,
                    component: item.component,
                    id: item.pluginId,
                    label: item.label,
                    tooltip: item.tooltip,
                    settingsComponent: item.settingsComponent,
                    assetRootPath: item.assetRootPath
                }
            }, true);
            this.state.pluginStatus = `${item.label || item.component} settings opened.`;
            this.state.pluginStatusType = "";
        } catch (error) {
            this.state.pluginStatus = error?.message || `Failed to open settings for ${key}.`;
            this.state.pluginStatusType = "error";
        } finally {
            this.state.pluginBusyActionKey = "";
            this.renderPluginSettings();
        }
    }

    async fetchAvatarJson(path, options = {}) {
        const response = await fetch(`/services/explorer/avatar-settings/${path}`, {
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                ...(options.body ? { 'Content-Type': 'application/json' } : {})
            },
            ...options
        });
        const parsed = await response.json().catch(() => ({}));
        if (!response.ok || parsed.ok === false) {
            throw new Error(parsed.error || `Avatar settings request failed (${response.status}).`);
        }
        return parsed;
    }

    async loadAvatarSettingsData() {
        this.state.avatarStatus = "Loading avatar settings...";
        this.state.avatarStatusType = "";
        this.renderAvatarSettings();
        await ensureAxiFaceLoaded();
        const me = await getCurrentProfileAvatar({ force: true });
        this.state.avatarUser = me.user || null;
        this.state.canManageAgentAvatars = Boolean(me.user?.canManageAgents);
        this.state.profileAvatar = normalizeAvatarConfig(me.config, me.config?.agentId || `profile:${me.user?.id || 'current-user'}`);
        this.state.profileAvatarEnabled = me.enabled !== false;
        this.state.profileAvatarSource = me.source || null;
        this.state.dpuProfileAvailable = me.source?.kind !== 'error';
        if (!this.state.dpuProfileAvailable) {
            this.state.avatarStatus = me.source?.error || "DPU My Space is unavailable. Profile avatar cannot be saved.";
            this.state.avatarStatusType = "error";
        }
        const agentsPayload = await this.fetchAvatarJson('agents');
        this.state.canManageAgentAvatars = Boolean(agentsPayload.canManageAgents);
        this.state.agentAvatarItems = Array.isArray(agentsPayload.agents) ? agentsPayload.agents : [];
        const selectedAgent = this.state.agentAvatarItems.find((item) => item.id === this.state.selectedAvatarAgentId)
            || this.state.agentAvatarItems[0]
            || null;
        this.state.selectedAvatarAgentId = selectedAgent?.id || "";
        this.state.selectedAgentAvatar = normalizeAvatarConfig(selectedAgent?.config, selectedAgent?.id || 'agent');
        this.state.selectedAgentAvatarEnabled = selectedAgent?.enabled !== false;
        this.state.avatarDataLoaded = true;
        if (this.state.avatarStatusType !== "error") {
            this.state.avatarStatus = "Avatar settings loaded.";
            this.state.avatarStatusType = "";
        }
        this.renderAvatarSettings();
    }

    renderAvatarSettings() {
        this.renderAvatarStatus();
        this.renderAvatarControls('profile');
        this.renderAvatarControls('agent');
        this.renderAvatarAgentList();
        this.renderAvatarPreviews();
        if (this.agentAvatarCardEl) {
            this.agentAvatarCardEl.hidden = !this.state.canManageAgentAvatars;
        }
        if (this.agentAvatarEnabledInput) {
            this.agentAvatarEnabledInput.checked = Boolean(this.state.selectedAgentAvatarEnabled);
            this.agentAvatarEnabledInput.disabled = this.state.avatarBusy || !this.state.canManageAgentAvatars || !this.state.selectedAvatarAgentId;
        }
        if (this.profileAvatarEnabledInput) {
            this.profileAvatarEnabledInput.checked = Boolean(this.state.profileAvatarEnabled);
            this.profileAvatarEnabledInput.disabled = this.state.avatarBusy || !this.state.dpuProfileAvailable;
        }
        if (this.saveProfileAvatarButton) {
            this.saveProfileAvatarButton.disabled = this.state.avatarBusy || !this.state.dpuProfileAvailable;
        }
        if (this.saveAgentAvatarButton) {
            this.saveAgentAvatarButton.disabled = this.state.avatarBusy || !this.state.canManageAgentAvatars || !this.state.selectedAvatarAgentId;
        }
    }

    renderAvatarStatus() {
        if (!this.avatarSettingsStatusEl) return;
        this.avatarSettingsStatusEl.textContent = this.state.avatarStatus || "";
        this.avatarSettingsStatusEl.classList.toggle("error", this.state.avatarStatusType === "error");
    }

    renderAvatarControls(scope) {
        const container = scope === 'profile' ? this.profileAvatarControlsEl : this.agentAvatarControlsEl;
        if (!container) return;
        const config = scope === 'profile' ? this.state.profileAvatar : this.state.selectedAgentAvatar;
        container.innerHTML = AVATAR_FIELD_DEFS.map((field) => {
            const value = config?.[field.key];
            if (field.type === 'checkbox') {
                return `
                    <label class="avatar-field avatar-field-checkbox">
                        <span>${escapeHtml(field.label)}</span>
                        <span class="avatar-checkbox-shell">
                            <input class="avatar-checkbox-input" type="checkbox" data-avatar-field="${field.key}" ${value ? 'checked' : ''}>
                        </span>
                    </label>
                `;
            }
            if (field.type === 'select') {
                return `
                    <label class="avatar-field">
                        <span>${escapeHtml(field.label)}</span>
                        <select class="form-input avatar-input" data-avatar-field="${field.key}">
                            ${field.options.map((option) => `<option value="${escapeHtml(option)}" ${String(value || '') === option ? 'selected' : ''}>${escapeHtml(option || 'default')}</option>`).join('')}
                        </select>
                    </label>
                `;
            }
            return `
                <label class="avatar-field">
                    <span>${escapeHtml(field.label)}</span>
                    <input class="form-input avatar-input" type="text" data-avatar-field="${field.key}" value="${escapeHtml(value || '')}">
                </label>
            `;
        }).join("");
    }

    renderAvatarPreviews() {
        if (this.profileAvatarPreviewEl) {
            this.profileAvatarPreviewEl.innerHTML = this.state.profileAvatarEnabled
                ? renderAxiFaceMarkup(this.state.profileAvatar)
                : `<span class="avatar-preview-fallback">${escapeHtml(this.state.avatarUser?.username?.[0] || '?')}</span>`;
        }
        if (this.agentAvatarPreviewEl) {
            this.agentAvatarPreviewEl.innerHTML = this.state.selectedAvatarAgentId
                ? renderAxiFaceMarkup(this.state.selectedAgentAvatar)
                : "";
        }
    }

    renderAvatarAgentList() {
        if (!this.avatarAgentListEl) return;
        if (!this.state.agentAvatarItems.length) {
            this.avatarAgentListEl.innerHTML = `<div class="plugin-settings-empty">No AI agents found in manifest.</div>`;
            return;
        }
        this.avatarAgentListEl.innerHTML = this.state.agentAvatarItems.map((item) => `
            <button
                type="button"
                class="avatar-agent-button ${item.id === this.state.selectedAvatarAgentId ? 'active' : ''} ${item.missing ? 'missing' : ''}"
                data-local-action="selectAvatarAgent ${escapeHtml(item.id)}"
            >
                ${escapeHtml(item.label || item.id)}${item.missing ? ' (missing)' : ''}
            </button>
        `).join("");
    }

    readAvatarControls(scope) {
        const container = scope === 'profile' ? this.profileAvatarControlsEl : this.agentAvatarControlsEl;
        const current = scope === 'profile' ? this.state.profileAvatar : this.state.selectedAgentAvatar;
        const next = { ...current };
        container?.querySelectorAll('[data-avatar-field]').forEach((field) => {
            const key = field.dataset.avatarField;
            next[key] = field.type === 'checkbox' ? Boolean(field.checked) : field.value;
        });
        next.agentId = current.agentId;
        return normalizeAvatarConfig(next, current.agentId);
    }

    handleAvatarControlsInput(scope) {
        if (scope === 'profile') {
            this.state.profileAvatar = this.readAvatarControls('profile');
        } else {
            this.state.selectedAgentAvatar = this.readAvatarControls('agent');
        }
        this.renderAvatarPreviews();
    }

    selectAvatarAgent(_target, agentId) {
        const item = this.state.agentAvatarItems.find((entry) => entry.id === agentId);
        if (!item) return;
        this.state.selectedAvatarAgentId = item.id;
        this.state.selectedAgentAvatar = normalizeAvatarConfig(item.config, item.id);
        this.state.selectedAgentAvatarEnabled = item.enabled !== false;
        this.renderAvatarSettings();
    }

    async saveProfileAvatar() {
        if (this.state.avatarBusy || !this.state.dpuProfileAvailable) return;
        this.state.avatarBusy = true;
        this.state.avatarStatus = "Saving profile avatar...";
        this.state.avatarStatusType = "";
        this.renderAvatarSettings();
        try {
            this.state.profileAvatar = this.readAvatarControls('profile');
            const payload = await saveCurrentProfileAvatar({
                enabled: this.state.profileAvatarEnabled,
                config: this.state.profileAvatar
            });
            this.state.profileAvatar = normalizeAvatarConfig(payload.config, this.state.profileAvatar.agentId);
            this.state.profileAvatarEnabled = payload.enabled !== false;
            this.state.profileAvatarSource = payload.source || null;
            this.state.avatarStatus = "Profile avatar saved in DPU My Space.";
            this.state.avatarStatusType = "";
        } catch (error) {
            this.state.avatarStatus = error?.message || "Failed to save profile avatar.";
            this.state.avatarStatusType = "error";
        } finally {
            this.state.avatarBusy = false;
            this.renderAvatarSettings();
        }
    }

    async saveAgentAvatar() {
        if (this.state.avatarBusy || !this.state.selectedAvatarAgentId) return;
        this.state.avatarBusy = true;
        this.state.avatarStatus = `Saving ${this.state.selectedAvatarAgentId} avatar...`;
        this.state.avatarStatusType = "";
        this.renderAvatarSettings();
        try {
            this.state.selectedAgentAvatar = this.readAvatarControls('agent');
            await this.fetchAvatarJson(`agents/${encodeURIComponent(this.state.selectedAvatarAgentId)}`, {
                method: 'PATCH',
                body: JSON.stringify({ config: this.state.selectedAgentAvatar })
            });
            await this.fetchAvatarJson(`agents/${encodeURIComponent(this.state.selectedAvatarAgentId)}/visibility`, {
                method: 'PATCH',
                body: JSON.stringify({ enabled: this.state.selectedAgentAvatarEnabled })
            });
            this.state.avatarStatus = `${this.state.selectedAvatarAgentId} avatar saved.`;
            this.state.avatarStatusType = "";
            this.state.avatarDataLoaded = false;
            window.dispatchEvent(new CustomEvent('assistOS:avatar-settings-updated', {
                detail: { type: 'agent', agentId: this.state.selectedAvatarAgentId, config: this.state.selectedAgentAvatar }
            }));
            await this.loadAvatarSettingsData();
        } catch (error) {
            this.state.avatarStatus = error?.message || "Failed to save agent avatar.";
            this.state.avatarStatusType = "error";
        } finally {
            this.state.avatarBusy = false;
            this.renderAvatarSettings();
        }
    }

    renderRows() {
        if (!this.listEl) return;
        const actions = getKeymapActions();
        this.listEl.innerHTML = actions.map((action) => {
            const shortcut = this.state.keymap[action.id] || "";
            const displayValue = formatShortcutForDisplay(shortcut) || "";
            return `
                <div class="keymap-row">
                    <div class="keymap-info">
                        <div class="keymap-label">${action.label}</div>
                        <div class="keymap-meta">${action.description}</div>
                    </div>
                    <div class="keymap-input-group">
                        <input type="text" class="form-input keymap-input" data-action-id="${action.id}" value="${displayValue}" readonly>
                        <button type="button" class="gray-button keymap-clear" data-action-id="${action.id}" data-local-action="clearShortcut ${action.id}">Clear</button>
                    </div>
                </div>
            `;
        }).join("");
        this.bindRowEvents();
        this.updateConflicts();
    }

    bindRowEvents() {
        const inputs = this.element.querySelectorAll(".keymap-input");
        inputs.forEach((input) => {
            if (input.dataset.bound) return;
            input.addEventListener("keydown", (event) => {
                const actionId = event.currentTarget?.dataset?.actionId;
                if (!actionId) return;
                if (event.key === "Tab") return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Escape") {
                    event.currentTarget.blur();
                    return;
                }
                if (event.key === "Backspace" || event.key === "Delete") {
                    this.setShortcut(actionId, "");
                    return;
                }
                const shortcut = eventToShortcut(event);
                if (!shortcut) return;
                this.setShortcut(actionId, shortcut);
            });
            input.dataset.bound = "true";
        });
    }

    clearShortcut(_target, actionId) {
        if (!actionId) return;
        this.setShortcut(actionId, "");
    }

    setShortcut(actionId, shortcut) {
        const normalized = shortcut ? normalizeShortcutString(shortcut) : "";
        this.state.keymap[actionId] = normalized;
        this.updateRowDisplay(actionId);
        this.updateConflicts();
    }

    updateRowDisplay(actionId) {
        const input = this.element.querySelector(`.keymap-input[data-action-id="${actionId}"]`);
        if (!input) return;
        const raw = this.state.keymap[actionId] || "";
        input.value = formatShortcutForDisplay(raw) || "";
    }

    updateConflicts() {
        const actions = getKeymapActions();
        const buckets = new Map();
        actions.forEach((action) => {
            const raw = this.state.keymap[action.id];
            const normalized = normalizeShortcutString(raw);
            if (!normalized) return;
            if (!buckets.has(normalized)) {
                buckets.set(normalized, []);
            }
            buckets.get(normalized).push(action.label);
        });

        const conflicts = [];
        for (const [shortcut, labels] of buckets.entries()) {
            if (labels.length > 1) {
                conflicts.push(`${formatShortcutForDisplay(shortcut)}: ${labels.join(", ")}`);
            }
        }

        this.state.hasConflicts = conflicts.length > 0;
        if (this.warningEl) {
            this.warningEl.textContent = conflicts.length
                ? `Shortcut conflicts: ${conflicts.join(" | ")}`
                : "";
        }
        if (this.saveButton) {
            this.saveButton.disabled = this.state.hasConflicts;
        }
    }

    selectTheme(_target, theme) {
        this.state.selectedTheme = theme === "dark" ? "dark" : "light";
        this.updateThemeSelection();
    }

    updateThemeSelection() {
        const options = this.element.querySelectorAll(".theme-option");
        options.forEach((option) => {
            const isActive = option.dataset.theme === this.state.selectedTheme;
            option.classList.toggle("active", isActive);
            option.setAttribute("aria-checked", isActive ? "true" : "false");
        });
    }

    syncEditorSettingsUi() {
        if (this.editorAutoSaveEnabledInput) {
            this.editorAutoSaveEnabledInput.checked = Boolean(this.state.editorAutoSaveEnabled);
        }
        if (this.editorAutoSaveIntervalInput) {
            const nextValue = String(this.state.editorAutoSaveIntervalSeconds || 10);
            if (this.editorAutoSaveIntervalInput.value !== nextValue) {
                this.editorAutoSaveIntervalInput.value = nextValue;
            }
            this.editorAutoSaveIntervalInput.disabled = !this.state.editorAutoSaveEnabled;
        }
    }

    handleEditorAutoSaveToggle() {
        this.state.editorAutoSaveEnabled = Boolean(this.editorAutoSaveEnabledInput?.checked);
        this.syncEditorSettingsUi();
    }

    handleEditorAutoSaveIntervalInput() {
        const nextValue = Number.parseInt(String(this.editorAutoSaveIntervalInput?.value ?? ''), 10);
        this.state.editorAutoSaveIntervalSeconds = Number.isFinite(nextValue) && nextValue >= 1 ? nextValue : 10;
        this.syncEditorSettingsUi();
    }

    resetDefaults() {
        this.state.keymap = { ...getDefaultKeymap() };
        this.renderRows();
    }

    saveSettings() {
        if (this.state.hasConflicts) return;
        const keymap = setKeymap(this.state.keymap);
        const theme = setTheme(this.state.selectedTheme);
        this.closeModal({
            keymap,
            theme,
            editorAutoSaveEnabled: Boolean(this.state.editorAutoSaveEnabled),
            editorAutoSaveIntervalSeconds: Number.isFinite(this.state.editorAutoSaveIntervalSeconds)
                ? Math.max(1, Math.round(this.state.editorAutoSaveIntervalSeconds))
                : 10
        });
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
