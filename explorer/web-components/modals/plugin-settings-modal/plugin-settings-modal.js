import { callExplorerTool, parseToolResult } from "../../../services/infrastructure/explorerApi.js";
import {
    compareRuntimePluginEntries,
    forEachRuntimePluginEntry,
    getRuntimePluginOrder,
    getRuntimePluginPolicyKey
} from "../../../utils/pluginUtils.core.js";
import { registerRuntimeComponent } from "../../../utils/pluginUtils.ui.js";

const settingsComponentPromises = new Map();

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

export class PluginSettingsModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.state = {
            items: [],
            settings: {},
            busyActionKey: "",
            status: "",
            statusType: ""
        };
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.cacheElements();
        this.render();
        await this.loadData();
    }

    cacheElements() {
        this.listEl = this.element.querySelector("#pluginSettingsList");
        this.statusEl = this.element.querySelector("#pluginSettingsStatus");
    }

    render() {
        this.renderStatus();
        this.renderList();
    }

    renderStatus() {
        if (!this.statusEl) return;
        this.statusEl.textContent = this.state.status || "";
        this.statusEl.classList.toggle("error", this.state.statusType === "error");
    }

    renderList() {
        if (!this.listEl) return;
        if (!this.state.items.length) {
            this.listEl.innerHTML = `<div class="plugin-settings-empty">No plugins discovered for this workspace.</div>`;
            return;
        }
        this.listEl.innerHTML = this.state.items.map((item) => {
            const enabled = this.isEnabled(item.key);
            const busyToggle = this.state.busyActionKey === `${item.key}::toggle`;
            const busySettings = this.state.busyActionKey === `${item.key}::settings`;
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

    isEnabled(key) {
        const entry = this.state.settings[key];
        if (!entry || typeof entry !== "object") {
            return true;
        }
        return entry.enabled !== false;
    }

    async loadData() {
        this.state.status = "Loading plugins...";
        this.state.statusType = "";
        this.renderStatus();
        try {
            let pluginsByLocation = getCachedRuntimePlugins();
            if (!pluginsByLocation) {
                const pluginsPayload = await callExplorerTool("collect_ide_plugins", {}, { raw: true, withLoader: false });
                pluginsByLocation = parseToolResult(pluginsPayload) || {};
            }
            const settingsPayload = await callExplorerTool("get_plugin_settings", {}, { raw: true, withLoader: false });
            const settings = normalizeSettingsMap(parseToolResult(settingsPayload));
            this.state.items = flattenPluginsByKey(pluginsByLocation);
            this.state.settings = settings;
            if (window.assistOS) {
                window.assistOS.pluginSettings = settings;
            }
            this.state.status = this.state.items.length
                ? `${this.state.items.length} plugins loaded.`
                : "No plugins discovered.";
            this.state.statusType = "";
            this.render();
        } catch (error) {
            this.state.status = error?.message || "Failed to load plugin settings.";
            this.state.statusType = "error";
            this.renderStatus();
        }
    }

    async togglePlugin(_target, key) {
        if (!key) return;
        const nextEnabled = !this.isEnabled(key);
        this.state.busyActionKey = `${key}::toggle`;
        this.state.status = `Saving ${key}...`;
        this.state.statusType = "";
        this.render();
        try {
            const payload = await callExplorerTool("set_plugin_enabled", {
                key,
                enabled: nextEnabled
            }, { raw: true, withLoader: false });
            const parsed = parseToolResult(payload) || {};
            this.state.settings = normalizeSettingsMap(parsed.settings || { plugins: this.state.settings });
            if (window.assistOS) {
                window.assistOS.pluginSettings = this.state.settings;
            }
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("assistos:plugin-settings-updated", {
                    detail: { settings: this.state.settings }
                }));
            }
            this.state.status = `${key} ${nextEnabled ? "enabled" : "disabled"} in workspace settings.`;
            this.state.statusType = "";
        } catch (error) {
            this.state.status = error?.message || `Failed to update ${key}.`;
            this.state.statusType = "error";
        } finally {
            this.state.busyActionKey = "";
            this.render();
        }
    }

    async openPluginSettings(_target, key) {
        if (!key) return;
        const item = this.state.items.find((entry) => entry?.key === key);
        if (!item || !item.settingsComponent) {
            return;
        }

        this.state.busyActionKey = `${key}::settings`;
        this.state.status = `Opening settings for ${key}...`;
        this.state.statusType = "";
        this.render();

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
            this.state.status = `${item.label || item.component} settings opened.`;
            this.state.statusType = "";
        } catch (error) {
            this.state.status = error?.message || `Failed to open settings for ${key}.`;
            this.state.statusType = "error";
        } finally {
            this.state.busyActionKey = "";
            this.render();
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element, null);
    }
}
