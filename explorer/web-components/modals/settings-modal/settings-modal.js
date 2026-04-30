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
import { callExplorerTool, parseToolResult } from "../../../services/infrastructure/explorerApi.js";
import {
    compareRuntimePluginEntries,
    forEachRuntimePluginEntry,
    getRuntimePluginOrder,
    getRuntimePluginPolicyKey
} from "../../../utils/pluginUtils.core.js";
import { registerRuntimeComponent } from "../../../utils/pluginUtils.ui.js";

const settingsComponentPromises = new Map();
const BASE_TABS = ['keymap', 'editor', 'theme', 'plugins'];

function getCurrentAgentName() {
    try {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return parts[0] || 'explorer';
    } catch (_) {
        return 'explorer';
    }
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
            assetRootPath: ""
        };
        existing.pluginCategory = plugin?.pluginCategory || existing.pluginCategory || category;
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
    }

    cacheElements() {
        this.keymapSection = this.element.querySelector('[data-section="keymap"]');
        this.editorSection = this.element.querySelector('[data-section="editor"]');
        this.themeSection = this.element.querySelector('[data-section="theme"]');
        this.pluginsSection = this.element.querySelector('[data-section="plugins"]');
        this.usersSection = this.element.querySelector('[data-section="users"]');
        this.usersTab = this.element.querySelector('[data-admin-tab]');
        this.usersFrame = this.element.querySelector('#usersSettingsFrame');
        this.listEl = this.element.querySelector("#keymapList");
        this.warningEl = this.element.querySelector("#keymapWarning");
        this.pluginSettingsListEl = this.element.querySelector("#pluginSettingsList");
        this.pluginSettingsStatusEl = this.element.querySelector("#pluginSettingsStatus");
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
            this.actionsEl.hidden = this.state.activeTab === "users";
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

    renderPluginSettingsStatus() {
        if (!this.pluginSettingsStatusEl) return;
        this.pluginSettingsStatusEl.textContent = this.state.pluginStatus || "";
        this.pluginSettingsStatusEl.classList.toggle("error", this.state.pluginStatusType === "error");
    }

    renderPluginSettingsList() {
        if (!this.pluginSettingsListEl) return;
        if (!this.state.pluginItems.length) {
            this.pluginSettingsListEl.innerHTML = `<div class="plugin-settings-empty">No plugins discovered for this workspace.</div>`;
            return;
        }
        this.pluginSettingsListEl.innerHTML = this.state.pluginItems.map((item) => {
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
