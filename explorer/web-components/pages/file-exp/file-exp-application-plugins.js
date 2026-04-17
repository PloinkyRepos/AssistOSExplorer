const APP_PLUGIN_SLOTS = Object.freeze({
    toolbar: 'file-exp:toolbar',
    rightBar: 'file-exp:right-bar',
    internal: 'file-exp:internal',
    accountMenu: 'file-exp:account-menu'
});

const MOUNT_CONTRIBUTION_TYPE = 'mount';

import { sortRuntimePluginEntries, getRuntimePluginPolicyKey } from "../../../utils/pluginUtils.core.js";
import { emitPluginMountedAudit } from "../../../services/audit/auditService.js";

function getPluginSettingsMap() {
    const settings = window.assistOS?.pluginSettings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return {};
    }
    return settings;
}

function getPluginKey(plugin) {
    return getRuntimePluginPolicyKey(plugin);
}

function isPluginEnabled(plugin) {
    const key = getPluginKey(plugin);
    if (!key) {
        return true;
    }
    const settings = getPluginSettingsMap();
    const entry = settings[key];
    return !entry || entry.enabled !== false;
}

export function getApplicationPluginsForSlot(slot, { contributionType = null } = {}) {
    const appPlugins = window.assistOS?.workspace?.appPlugins;
    const plugins = appPlugins && typeof appPlugins === 'object' && !Array.isArray(appPlugins)
        ? appPlugins[slot]
        : null;
    const filteredPlugins = Array.isArray(plugins)
        ? plugins.filter((plugin) => {
            if (!plugin || !isPluginEnabled(plugin)) {
                return false;
            }
            if (!contributionType) {
                return true;
            }
            return String(plugin.contributionType || MOUNT_CONTRIBUTION_TYPE).trim() === contributionType;
        })
        : [];
    return filteredPlugins.length
        ? sortRuntimePluginEntries(filteredPlugins)
        : [];
}

function encodeContext(context) {
    try {
        return encodeURIComponent(JSON.stringify(context || {}));
    } catch {
        return encodeURIComponent('{}');
    }
}

function buildPluginContext(fileExp, slot) {
    return {
        slot,
        currentPath: fileExp.normalizePath(fileExp.state.path || '/'),
        selectedPath: fileExp.normalizePath(fileExp.state.selectedPath || ''),
        workspaceVersion: Number.isFinite(fileExp.state.workspaceVersion) ? fileExp.state.workspaceVersion : 0
    };
}

function getContainerOrientation(container, slot) {
    if (container?.classList?.contains('app-toolbar-slot')) {
        return 'horizontal';
    }
    if (container?.classList?.contains('app-plugin-bar')) {
        return 'vertical';
    }
    return slot === APP_PLUGIN_SLOTS.toolbar ? 'horizontal' : 'vertical';
}

async function ensureRuntimeComponent(componentName) {
    const ensureComponentRegistered = window.assistOS?.webSkel?.ensureComponentRegistered || window.UI?.ensureComponentRegistered;
    if (typeof ensureComponentRegistered === 'function') {
        await ensureComponentRegistered(componentName);
    }
}

function updateMountedPluginElement(pluginElement, plugin, context) {
    if (!pluginElement) {
        return;
    }
    const label = typeof plugin?.label === 'string' && plugin.label.trim()
        ? plugin.label.trim()
        : typeof plugin?.tooltip === 'string' && plugin.tooltip.trim()
            ? plugin.tooltip.trim()
            : typeof plugin?.component === 'string' && plugin.component.trim()
                ? plugin.component.trim()
                : 'Plugin';
    const tooltip = typeof plugin?.tooltip === 'string' && plugin.tooltip.trim()
        ? plugin.tooltip.trim()
        : label;
    const encodedContext = encodeContext(context);
    pluginElement.setAttribute('data-context', encodedContext);
    pluginElement.setAttribute('data-plugin-label', label);
    pluginElement.setAttribute('data-plugin-tooltip', tooltip);
    pluginElement.setAttribute('data-plugin-icon', typeof plugin?.icon === 'string' ? plugin.icon : '');
    if (typeof context?.slot === 'string' && context.slot.trim()) {
        pluginElement.setAttribute('data-host-slot', context.slot.trim());
    } else {
        pluginElement.removeAttribute('data-host-slot');
    }
    if (typeof context?.orientation === 'string' && context.orientation.trim()) {
        pluginElement.setAttribute('data-host-orientation', context.orientation.trim());
    } else {
        pluginElement.removeAttribute('data-host-orientation');
    }
    const presenter = pluginElement.webSkelPresenter;
    if (typeof presenter?.updateHostContext === 'function') {
        presenter.updateHostContext({
            ...(context || {}),
            pluginLabel: label,
            pluginTooltip: tooltip,
            pluginIcon: typeof plugin?.icon === 'string' ? plugin.icon : ''
        });
    }
}

function collectExistingMounts(container) {
    const mounts = new Map();
    const nodes = Array.from(container.querySelectorAll('[data-app-plugin-key]'));
    for (const node of nodes) {
        const key = node.getAttribute('data-app-plugin-key');
        if (!key) {
            continue;
        }
        if (mounts.has(key)) {
            node.remove();
            continue;
        }
        mounts.set(key, node);
    }
    return mounts;
}

async function mountSlot(container, slot, plugins, context) {
    if (!container) {
        return;
    }

    container.classList.toggle('is-empty', plugins.length === 0);
    const contextWithOrientation = {
        ...(context || {}),
        orientation: getContainerOrientation(container, slot)
    };
    const existingMounts = collectExistingMounts(container);
    const seen = new Set();
    const orderedMounts = [];

    for (const plugin of plugins) {
        const key = getPluginKey(plugin);
        if (!key) {
            continue;
        }
        seen.add(key);
        await ensureRuntimeComponent(plugin.component);

        let mount = existingMounts.get(key);
        if (!mount) {
            mount = document.createElement('div');
            mount.className = 'app-plugin-mount';
            mount.setAttribute('data-app-plugin-key', key);
            mount.setAttribute('data-app-plugin-slot', slot);
            const pluginElement = document.createElement(plugin.component);
            pluginElement.setAttribute('data-presenter', plugin.component);
            mount.appendChild(pluginElement);
            container.appendChild(mount);
        }

        const pluginElement = mount.querySelector(plugin.component);
        if (pluginElement) {
            updateMountedPluginElement(pluginElement, plugin, contextWithOrientation);
        }
        void emitPluginMountedAudit(key, contextWithOrientation);

        orderedMounts.push(mount);
    }

    for (const [key, node] of existingMounts.entries()) {
        if (!seen.has(key)) {
            node.remove();
        }
    }

    for (const node of orderedMounts) {
        if (node && node.parentNode === container) {
            container.appendChild(node);
        }
    }
}

async function performRenderApplicationPluginSlots(fileExp) {
    if (!fileExp?.element) {
        return;
    }

    const toolbarContainer = fileExp.element.querySelector('#fileExpToolbarPlugins');
    const rightBarContainer = fileExp.element.querySelector('#fileExpPluginBar');
    const internalContainer = fileExp.element.querySelector('#fileExpInternalPlugins');
    const accountMenuContainer = fileExp.element.querySelector('#fileExpAccountMenuPlugins');
    const toolbarPlugins = getApplicationPluginsForSlot(APP_PLUGIN_SLOTS.toolbar, { contributionType: MOUNT_CONTRIBUTION_TYPE });
    const rightBarPlugins = getApplicationPluginsForSlot(APP_PLUGIN_SLOTS.rightBar, { contributionType: MOUNT_CONTRIBUTION_TYPE });
    const internalPlugins = getApplicationPluginsForSlot(APP_PLUGIN_SLOTS.internal, { contributionType: MOUNT_CONTRIBUTION_TYPE });
    const accountMenuPlugins = getApplicationPluginsForSlot(APP_PLUGIN_SLOTS.accountMenu, { contributionType: MOUNT_CONTRIBUTION_TYPE });
    const toolbarContext = buildPluginContext(fileExp, APP_PLUGIN_SLOTS.toolbar);
    const rightBarContext = buildPluginContext(fileExp, APP_PLUGIN_SLOTS.rightBar);
    const internalContext = buildPluginContext(fileExp, APP_PLUGIN_SLOTS.internal);
    const accountMenuContext = buildPluginContext(fileExp, APP_PLUGIN_SLOTS.accountMenu);

    await mountSlot(toolbarContainer, APP_PLUGIN_SLOTS.toolbar, toolbarPlugins, toolbarContext);
    await mountSlot(rightBarContainer, APP_PLUGIN_SLOTS.rightBar, rightBarPlugins, rightBarContext);
    await mountSlot(internalContainer, APP_PLUGIN_SLOTS.internal, internalPlugins, internalContext);
    await mountSlot(accountMenuContainer, APP_PLUGIN_SLOTS.accountMenu, accountMenuPlugins, accountMenuContext);
}

export async function renderApplicationPluginSlots(fileExp) {
    if (!fileExp?.element) {
        return;
    }

    const previousRender = fileExp.__appPluginRenderPromise || Promise.resolve();
    const nextRender = previousRender
        .catch(() => {})
        .then(() => performRenderApplicationPluginSlots(fileExp));

    fileExp.__appPluginRenderPromise = nextRender;

    try {
        await nextRender;
    } finally {
        if (fileExp.__appPluginRenderPromise === nextRender) {
            fileExp.__appPluginRenderPromise = null;
        }
    }
}

export function attachApplicationPluginHost(fileExp) {
    const rerender = () => {
        fileExp.toolbarMenuLoadToken = (Number(fileExp.toolbarMenuLoadToken) || 0) + 1;
        fileExp.contextMenuLoadToken = (Number(fileExp.contextMenuLoadToken) || 0) + 1;
        fileExp.toolbarMenuItems = [];
        fileExp.contextMenuItemsByPath = new Map();
        if (typeof fileExp.closeActionMenu === 'function') {
            fileExp.closeActionMenu(false);
        }
        if (typeof fileExp.renderEntries === 'function') {
            fileExp.renderEntries();
        }
        if (typeof fileExp.refreshToolbarMenuItems === 'function') {
            fileExp.refreshToolbarMenuItems().catch((error) => {
                console.error('[app-plugins] Failed to refresh toolbar menu items', error);
            });
        }
        renderApplicationPluginSlots(fileExp).catch((error) => {
            console.error('[app-plugins] Failed to render application plugin slots', error);
        });
    };

    fileExp.setWindowListener?.('file-exp-app-plugins-settings', 'assistos:plugin-settings-updated', rerender);
    fileExp.registerCleanup?.(() => {
        const toolbarContainer = fileExp.element?.querySelector?.('#fileExpToolbarPlugins');
        const rightBarContainer = fileExp.element?.querySelector?.('#fileExpPluginBar');
        const internalContainer = fileExp.element?.querySelector?.('#fileExpInternalPlugins');
        if (toolbarContainer) {
            toolbarContainer.replaceChildren();
        }
        if (rightBarContainer) {
            rightBarContainer.replaceChildren();
        }
        if (internalContainer) {
            internalContainer.replaceChildren();
        }
        fileExp.__appPluginRenderPromise = null;
    });
}
