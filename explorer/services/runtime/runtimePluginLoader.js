import {
    forEachRuntimePluginEntry,
    mergeRuntimePluginsIntoAssistOS,
    normalizeRuntimePlugins
} from '../../utils/pluginUtils.core.js';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isWorkspaceFilesUrl = (value) => isNonEmptyString(value) && value.trim().startsWith('/workspace-files/');
const isUrlOnlyGlobalSettingsPlugin = (plugin) => (
    plugin?.type === 'global'
    && isNonEmptyString(plugin?.settingsUrl)
    && plugin.settingsUrl.trim().startsWith('/')
    && !plugin.settingsUrl.trim().startsWith('//')
);

export function createRuntimePluginLoader({
    agentId,
    runtimePluginTool,
    assistosSDK,
    componentRegistry
}) {
    if (!assistosSDK) {
        throw new Error('[runtime] runtimePluginLoader requires assistOS SDK.');
    }
    if (!componentRegistry) {
        throw new Error('[runtime] runtimePluginLoader requires a component registry.');
    }

    let cachedRawPlugins = null;
    let cachedNormalizedPlugins = null;
    let inflightFetch = null;

    const fetchRuntimePlugins = async () => {
        if (cachedRawPlugins && cachedNormalizedPlugins) {
            return {
                raw: cachedRawPlugins,
                normalized: cachedNormalizedPlugins
            };
        }
        if (inflightFetch) {
            return inflightFetch;
        }

        inflightFetch = (async () => {
            const rawPlugins = await assistosSDK.fetchRuntimePlugins(agentId, runtimePluginTool);
            const normalized = normalizeRuntimePlugins(rawPlugins);
            cachedRawPlugins = rawPlugins || {};
            cachedNormalizedPlugins = normalized;
            return {
                raw: cachedRawPlugins,
                normalized: cachedNormalizedPlugins
            };
        })();

        try {
            return await inflightFetch;
        } finally {
            inflightFetch = null;
        }
    };

    const scheduleComponents = (runtimePlugins, { includeDependencies = true } = {}) => {
        const scheduled = new Map();
        const scheduleComponent = (meta) => {
            const componentName = meta?.componentName;
            const agent = meta?.agent;
            if (!isNonEmptyString(componentName) || !isNonEmptyString(agent)) {
                return;
            }
            const key = `${agent.trim()}::${componentName.trim()}`;
            const normalizedMeta = {
                componentName: componentName.trim(),
                presenterName: isNonEmptyString(meta.presenterName) ? meta.presenterName.trim() : undefined,
                agent: agent.trim(),
                ownerComponent: isNonEmptyString(meta.ownerComponent) ? meta.ownerComponent.trim() : undefined,
                isDependency: Boolean(meta.isDependency),
                customPath: isNonEmptyString(meta.customPath) ? meta.customPath.trim() : undefined,
                baseUrl: isNonEmptyString(meta.baseUrl) ? meta.baseUrl.trim() : undefined,
                componentType: meta?.componentType === 'modals' ? 'modals' : 'components'
            };
            if (!scheduled.has(key)) {
                scheduled.set(key, normalizedMeta);
                return;
            }

            const existingMeta = scheduled.get(key);
            if (!isWorkspaceFilesUrl(existingMeta?.baseUrl) && isWorkspaceFilesUrl(normalizedMeta.baseUrl)) {
                scheduled.set(key, normalizedMeta);
            }
        };

        forEachRuntimePluginEntry(runtimePlugins, (plugin) => {
            if (!plugin || typeof plugin !== 'object') {
                return;
            }
            if (isUrlOnlyGlobalSettingsPlugin(plugin)) {
                return;
            }
            scheduleComponent({
                componentName: plugin.component,
                presenterName: plugin.presenter,
                agent: plugin.agent,
                ownerComponent: plugin.component,
                isDependency: false,
                baseUrl: plugin.componentBaseUrl,
                componentType: plugin.type === 'modal' ? 'modals' : 'components'
            });
            if (includeDependencies && Array.isArray(plugin.dependencies)) {
                for (const dependency of plugin.dependencies) {
                    if (!dependency || typeof dependency !== 'object') {
                        continue;
                    }
                    scheduleComponent({
                        componentName: dependency.component || dependency.name,
                        presenterName: dependency.presenter || dependency.presenterClassName,
                        agent: dependency.agent || plugin.agent,
                        ownerComponent: dependency.ownerComponent || plugin.component,
                        isDependency: true,
                        customPath: dependency.path || dependency.directory,
                        baseUrl: dependency.baseUrl,
                        componentType: dependency.type === 'modal' ? 'modals' : 'components'
                    });
                }
            }
        });

        return scheduled;
    };

    const loadComponents = async (runtimePlugins, options = {}) => {
        const scheduled = scheduleComponents(runtimePlugins, options);
        const entries = Array.from(scheduled.entries());
        if (!entries.length) {
            return new Map();
        }

        const loadPromises = entries.map(async ([key, meta]) => {
            try {
                const component = await componentRegistry.loadComponent(meta);
                return [key, component];
            } catch (error) {
                console.error(`[runtime-plugins] Failed to load component ${meta.componentName} from agent ${meta.agent}:`, error);
                return [key, null];
            }
        });

        const results = await Promise.allSettled(loadPromises);
        const loaded = new Map();
        for (const result of results) {
            if (result.status !== 'fulfilled') {
                continue;
            }
            const [key, component] = result.value;
            if (component) {
                loaded.set(key, component);
            }
        }
        return loaded;
    };

    const ensureComponentRegistered = async (componentName, runtimePlugins) => {
        if (!isNonEmptyString(componentName)) {
            return null;
        }

        const plugins = runtimePlugins || cachedNormalizedPlugins || (await fetchRuntimePlugins()).normalized;
        const scheduled = scheduleComponents(plugins, { includeDependencies: true });
        const requestedComponentName = componentName.trim();
        const meta = Array.from(scheduled.values()).find((entry) => entry.componentName === requestedComponentName);
        if (!meta) {
            return null;
        }

        if (meta.isDependency && isNonEmptyString(meta.ownerComponent)) {
            const relatedEntries = Array.from(scheduled.values()).filter((entry) => (
                entry.agent === meta.agent
                && (
                    entry.componentName === requestedComponentName
                    || entry.componentName === meta.ownerComponent
                    || entry.ownerComponent === meta.ownerComponent
                )
            ));
            await Promise.all(relatedEntries.map((entry) => componentRegistry.loadComponent(entry)));
            return componentRegistry.getCachedComponent(meta) || componentRegistry.loadComponent(meta);
        }

        return componentRegistry.loadComponent(meta);
    };

    const mergeIntoAssistOS = (assistOS, runtimePlugins) => {
        mergeRuntimePluginsIntoAssistOS(assistOS, runtimePlugins);
    };

    return {
        fetchRuntimePlugins,
        loadComponents,
        ensureComponentRegistered,
        mergeIntoAssistOS
    };
}
