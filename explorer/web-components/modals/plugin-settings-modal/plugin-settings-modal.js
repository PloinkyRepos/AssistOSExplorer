import { callExplorerTool, parseToolResult } from "../../../services/infrastructure/explorerApi.js";
import { compareRuntimePluginEntries, getRuntimePluginOrder } from "../../../utils/pluginUtils.core.js";

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
    const buckets = pluginBuckets && typeof pluginBuckets === "object" ? pluginBuckets : {};
    const items = new Map();
    for (const [category, categoryBuckets] of Object.entries(buckets)) {
        if (!categoryBuckets || typeof categoryBuckets !== "object" || Array.isArray(categoryBuckets)) continue;
        for (const [location, plugins] of Object.entries(categoryBuckets)) {
            if (!Array.isArray(plugins)) continue;
            for (const plugin of plugins) {
                const agent = typeof plugin?.agent === "string" && plugin.agent.trim() ? plugin.agent.trim() : "unknown";
                const component = typeof plugin?.component === "string" && plugin.component.trim() ? plugin.component.trim() : "";
                if (!component) continue;
                const key = `${agent}/${component}`;
                const existing = items.get(key) || {
                    key,
                    agent,
                    component,
                    label: "",
                    tooltip: "",
                    pluginCategory: category,
                    locations: [],
                    locationOrder: getRuntimePluginOrder(plugin)
                };
                existing.pluginCategory = plugin?.pluginCategory || existing.pluginCategory || category;
                existing.locationOrder = Math.min(existing.locationOrder, getRuntimePluginOrder(plugin));
                existing.label = typeof plugin?.label === "string" && plugin.label.trim()
                    ? plugin.label.trim()
                    : existing.label || component;
                existing.tooltip = typeof plugin?.tooltip === "string" && plugin.tooltip.trim()
                    ? plugin.tooltip.trim()
                    : existing.tooltip || existing.label;
                if (!existing.locations.includes(location)) {
                    existing.locations.push(location);
                }
                items.set(key, existing);
            }
        }
    }
    return Array.from(items.values())
        .map((item) => ({
            ...item,
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
            busyKey: "",
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
            const busy = this.state.busyKey === item.key;
            const locations = item.locations.join(", ");
            return `
                <div class="plugin-settings-row">
                    <div class="plugin-settings-info">
                        <div class="plugin-settings-key">${item.label || item.component}</div>
                        <div class="plugin-settings-meta">${item.key} · Category: ${item.pluginCategory} · Locations: ${locations}</div>
                    </div>
                    <button
                        type="button"
                        class="plugin-settings-toggle ${enabled ? "enabled" : ""}"
                        data-local-action="togglePlugin ${item.key}"
                        ${busy ? "disabled" : ""}
                    >
                        ${enabled ? "Enabled" : "Disabled"}
                    </button>
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
        this.state.busyKey = key;
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
            this.state.busyKey = "";
            this.render();
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element, null);
    }
}
