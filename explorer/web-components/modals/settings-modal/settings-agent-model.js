function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

export function normalizeAgentSettingsPayload(payload) {
    const settings = Array.isArray(payload) ? payload : [];
    return settings
        .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                return null;
            }
            const key = normalizeString(entry.key);
            const label = normalizeString(entry.label);
            const ownerAgent = normalizeString(entry.ownerAgent);
            const pluginKey = normalizeString(entry.pluginKey);
            if (!key || !label || !ownerAgent || !pluginKey) {
                return null;
            }
            return {
                key,
                label,
                ownerAgent,
                pluginKey,
                scope: normalizeString(entry.scope) || "workspace",
                settingsComponent: normalizeString(entry.settingsComponent),
                settingsUrl: normalizeString(entry.settingsUrl),
                adminOnly: entry.adminOnly === true
            };
        })
        .filter(Boolean);
}

export function buildAgentSettingsItems(agentSettings = [], pluginItems = [], { isAdmin = true } = {}) {
    const pluginByKey = new Map(pluginItems.map((item) => [item.key, item]));
    return normalizeAgentSettingsPayload(agentSettings)
        .filter((definition) => isAdmin || !definition.adminOnly)
        .map((definition) => {
            const sourcePlugin = pluginByKey.get(definition.pluginKey) || null;
            const settingsComponent = definition.settingsComponent || sourcePlugin?.settingsComponent || "";
            const settingsUrl = definition.settingsUrl || sourcePlugin?.settingsUrl || "";
            return {
                ...definition,
                sourcePlugin,
                component: sourcePlugin?.component || "",
                pluginId: sourcePlugin?.pluginId || "",
                available: Boolean(sourcePlugin) && Boolean(settingsUrl || settingsComponent),
                settingsComponent,
                settingsUrl,
                assetRootPath: sourcePlugin?.assetRootPath || "",
                componentBaseUrl: sourcePlugin?.componentBaseUrl || ""
            };
        });
}

