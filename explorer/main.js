import WebSkel from './WebSkel/webskel.mjs';
import assistosSDK, { initialiseAssistOS } from './services/assistosSDK.js';
import { createComponentRegistry } from './services/runtime/componentRegistry.js';
import { createRuntimePluginLoader } from './services/runtime/runtimePluginLoader.js';
import { attachUiFallbacks } from './services/runtime/uiFallbacks.js';
import { filterRuntimePluginsByApplicationPolicy } from './utils/pluginUtils.core.js';
import { initializeTheme } from './utils/theme.js';

const EXPLORER_AGENT_ID = 'explorer';
const RUNTIME_PLUGIN_TOOL = 'collect_ide_plugins';

if (typeof window !== 'undefined') {
    window.ASSISTOS_AGENT_ID = window.ASSISTOS_AGENT_ID || EXPLORER_AGENT_ID;
}

const hasRuntimePlugins = (runtimePlugins) => {
    if (!runtimePlugins) {
        return false;
    }
    return Object.values(runtimePlugins).some((buckets) => (
        buckets
        && typeof buckets === 'object'
        && !Array.isArray(buckets)
        && Object.values(buckets).some((entries) => Array.isArray(entries) && entries.length > 0)
    ));
};

const normalizePluginSettings = (payload) => {
    const plugins = payload?.plugins;
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
        return {};
    }
    return plugins;
};

const normalizeApplicationPluginPolicy = (payload) => {
    const raw = payload?.applicationPlugins;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }

    const normalized = {};
    for (const [key, value] of Object.entries(raw)) {
        const trimmedKey = typeof key === 'string' ? key.trim() : '';
        if (!trimmedKey || typeof value !== 'boolean') {
            continue;
        }
        normalized[trimmedKey] = value;
    }
    return normalized;
};

async function loadExplorerManifest() {
    try {
        const response = await fetch('./manifest.json', { cache: 'no-cache' });
        if (!response.ok) {
            return {};
        }
        const parsed = await response.json();
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
        return {};
    }
}

async function start() {
    initializeTheme();
    const webSkel = await WebSkel.initialise('webskel.json');
    webSkel.appServices = assistosSDK;

    const componentRegistry = createComponentRegistry(webSkel);
    const runtimePluginLoader = createRuntimePluginLoader({
        agentId: EXPLORER_AGENT_ID,
        runtimePluginTool: RUNTIME_PLUGIN_TOOL,
        assistosSDK,
        componentRegistry
    });

    const explorerManifest = await loadExplorerManifest();
    const applicationPluginPolicy = normalizeApplicationPluginPolicy(explorerManifest);
    const { raw: rawRuntimePlugins, normalized: runtimePluginsRaw } = await runtimePluginLoader.fetchRuntimePlugins();
    const runtimePlugins = filterRuntimePluginsByApplicationPolicy(runtimePluginsRaw, applicationPluginPolicy);
    const filteredRawRuntimePlugins = filterRuntimePluginsByApplicationPolicy(rawRuntimePlugins, applicationPluginPolicy);
    const pluginSettingsResult = await assistosSDK.callTool(EXPLORER_AGENT_ID, 'get_plugin_settings', {});
    const pluginSettings = normalizePluginSettings(pluginSettingsResult?.json);
    const assistOS = initialiseAssistOS({
        ui: webSkel,
        runtimePlugins: hasRuntimePlugins(runtimePlugins) ? runtimePlugins : undefined
    });
    assistOS.webSkel = webSkel;
    assistOS.appServices = assistosSDK;
    assistOS.explorerManifest = explorerManifest;
    assistOS.applicationPluginPolicy = applicationPluginPolicy;
    assistOS.runtimePlugins = runtimePlugins;
    assistOS.rawRuntimePlugins = filteredRawRuntimePlugins || {};
    assistOS.pluginSettings = pluginSettings;
    runtimePluginLoader.mergeIntoAssistOS(assistOS, runtimePlugins);

    const installRuntimeComponentGuards = () => {
        const ensureComponentRegistered = async (componentName) => {
            const normalizedName = typeof componentName === 'string' ? componentName.trim() : '';
            if (!normalizedName) {
                return null;
            }
            return runtimePluginLoader.ensureComponentRegistered(normalizedName, runtimePlugins);
        };

        webSkel.ensureComponentRegistered = ensureComponentRegistered;

        const wrapComponentOpener = (methodName) => {
            const original = webSkel[methodName];
            if (typeof original !== 'function') {
                return;
            }
            webSkel[methodName] = async (componentName, ...args) => {
                await ensureComponentRegistered(componentName);
                return original.call(webSkel, componentName, ...args);
            };
        };

        wrapComponentOpener('showModal');
        wrapComponentOpener('createReactiveModal');
    };

    installRuntimeComponentGuards();

    if (typeof window !== 'undefined') {
        window.UI = webSkel;
    }

    attachUiFallbacks(webSkel);

    webSkel.setLoading(`
        <div class="spinner-container">
            <div class="spinner-shell">
                <div class="spinner-orbit">
                    <span></span><span></span><span></span>
                </div>
                <div class="spinner-caption">
                </div>
            </div>
        </div>
    `);
    webSkel.setDomElementForPages(document.querySelector("#page_content"));
    const loader = document.querySelector("#before_webskel_loader");
    loader.close();
    loader.remove();

    const hash = window.location.hash;
    let pageName;
    let url;
    if (hash) {
        url = hash.substring(1);
        pageName = url.split('/')[0].split('?')[0];
    } else {
        pageName = 'file-exp';
        url = 'file-exp';
    }

    const loadedRuntimeComponents = await runtimePluginLoader.loadComponents(runtimePlugins);
    assistOS.runtimePluginComponents = loadedRuntimeComponents;

    await webSkel.changeToDynamicPage(pageName || 'file-exp', url || 'file-exp');
    window.webSkel = webSkel;
}

start().catch((error) => {
    console.error('[explorer] Failed to bootstrap application', error);
});
