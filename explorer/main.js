import WebSkel from '/web-libs/webskel/webskel.mjs';
import assistosSDK, { initialiseAssistOS } from './services/assistosSDK.js';
import { createComponentRegistry } from './services/runtime/componentRegistry.js';
import { createRuntimePluginLoader } from './services/runtime/runtimePluginLoader.js';
import { filterRuntimePluginsByPolicy, forEachRuntimePluginEntry } from './utils/pluginUtils.core.js';
import { initializeTheme } from './utils/theme.js';

const EXPLORER_AGENT_ID = 'explorer';
const RUNTIME_PLUGIN_TOOL = 'collect_ide_plugins';
const ROOM_ID_PATTERN = /^room_[0-9a-fA-F-]{36}$/;

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

const normalizeRuntimePluginPolicy = (payload) => {
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

const parseAllowedDirectories = (result) => {
    if (Array.isArray(result?.json)) {
        return result.json.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
    if (typeof result?.text !== 'string') {
        return [];
    }
    return result.text
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry && !/^allowed directories:?$/i.test(entry));
};

function getRoomEntryFromUrl() {
    if (typeof window === 'undefined') {
        return null;
    }
    const params = new URLSearchParams(window.location.search || '');
    const roomId = String(params.get('roomId') || '').trim();
    if (!ROOM_ID_PATTERN.test(roomId)) {
        return null;
    }
    return {
        roomId
    };
}

function hasWebMeetRuntimePlugin(runtimePlugins) {
    let found = false;
    forEachRuntimePluginEntry(runtimePlugins, (plugin) => {
        const agent = String(plugin?.agent || '').trim();
        const id = String(plugin?.id || '').trim();
        const component = String(plugin?.component || '').trim();
        if (agent === 'webmeetAgent' && (id === 'webmeet' || component === 'webmeet-tool-button')) {
            found = true;
        }
    });
    return found;
}

async function bootstrapWorkspaceRoot() {
    try {
        const result = await assistosSDK.callTool(EXPLORER_AGENT_ID, 'list_allowed_directories', {});
        const roots = parseAllowedDirectories(result);
        const workspaceRoot = roots.find((entry) => entry.startsWith('/')) || '';
        if (!workspaceRoot || typeof window === 'undefined') {
            return workspaceRoot;
        }
        window.ASSISTOS_FS_ROOT = workspaceRoot;
        window.MCP_FS_ROOT = window.MCP_FS_ROOT || workspaceRoot;
        return workspaceRoot;
    } catch (_) {
        return '';
    }
}

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
    const roomEntry = getRoomEntryFromUrl();
    if (!roomEntry) {
        await bootstrapWorkspaceRoot();
    }

    const componentRegistry = createComponentRegistry(webSkel);
    const runtimePluginLoader = createRuntimePluginLoader({
        agentId: EXPLORER_AGENT_ID,
        runtimePluginTool: RUNTIME_PLUGIN_TOOL,
        assistosSDK,
        componentRegistry
    });

    const explorerManifest = await loadExplorerManifest();
    const runtimePluginPolicy = normalizeRuntimePluginPolicy(explorerManifest);
    const { raw: rawRuntimePlugins, normalized: runtimePluginsRaw } = await runtimePluginLoader.fetchRuntimePlugins();
    const runtimePlugins = filterRuntimePluginsByPolicy(runtimePluginsRaw, runtimePluginPolicy);
    const filteredRawRuntimePlugins = filterRuntimePluginsByPolicy(rawRuntimePlugins, runtimePluginPolicy);
    if (roomEntry && !hasWebMeetRuntimePlugin(runtimePlugins)) {
        throw new Error('WebMeet runtime plugin is unavailable.');
    }
    const pluginSettingsResult = roomEntry
        ? { json: {} }
        : await assistosSDK.callTool(EXPLORER_AGENT_ID, 'get_plugin_settings', {});
    const pluginSettings = normalizePluginSettings(pluginSettingsResult?.json);
    const assistOS = initialiseAssistOS({
        ui: webSkel,
        runtimePlugins: hasRuntimePlugins(runtimePlugins) ? runtimePlugins : undefined
    });
    assistOS.webSkel = webSkel;
    assistOS.appServices = assistosSDK;
    assistOS.explorerManifest = explorerManifest;
    assistOS.applicationPluginPolicy = runtimePluginPolicy;
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

        const originalChangeToDynamicPage = webSkel.changeToDynamicPage;
        if (typeof originalChangeToDynamicPage === 'function') {
            webSkel.changeToDynamicPage = async (componentName, ...args) => {
                await ensureComponentRegistered(componentName);
                return originalChangeToDynamicPage.call(webSkel, componentName, ...args);
            };
        }
    };

    installRuntimeComponentGuards();

    if (typeof window !== 'undefined') {
        window.UI = webSkel;
    }

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
    let suppressNavigationHash = false;
    if (hash) {
        url = hash.substring(1);
        pageName = url.split('/')[0].split('?')[0];
    } else if (ROOM_ID_PATTERN.test(String(new URLSearchParams(window.location.search || '').get('roomId') || '').trim())) {
        pageName = 'webmeet-dashboard';
        url = 'webmeet-dashboard';
    } else {
        pageName = 'file-exp';
        url = 'file-exp';
    }

    const loadedRuntimeComponents = await runtimePluginLoader.loadComponents(runtimePlugins, { includeDependencies: false });
    assistOS.runtimePluginComponents = loadedRuntimeComponents;

    await webSkel.changeToDynamicPage(pageName || 'file-exp', url || 'file-exp', null, suppressNavigationHash);
    window.webSkel = webSkel;
}

start().catch(async (error) => {
    console.error('[explorer] Failed to bootstrap application', error);
    const beforeLoader = document.querySelector('#before_webskel_loader');
    beforeLoader?.close?.();
    beforeLoader?.remove?.();
    window.webSkel?.clearLoading?.();

    const message = error?.message || 'Explorer failed to load.';
    const technical = error?.stack || String(error);
    if (typeof window.showApplicationError === 'function') {
        await window.showApplicationError('Explorer failed to load', message, technical);
        return;
    }

    const container = document.createElement('main');
    container.className = 'application-error';
    container.setAttribute('role', 'alert');
    const title = document.createElement('h1');
    title.textContent = 'Explorer failed to load';
    const details = document.createElement('p');
    details.textContent = message;
    container.append(title, details);
    document.body.replaceChildren(container);
});
