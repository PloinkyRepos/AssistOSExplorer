import { getApplicationPluginsForSlot } from "./file-exp-application-plugins.js";
import { DPU_SECRETS_PATH, isDpuManagedPath } from "./file-exp-dpu-provider.js";
import { resolveExplorerPathToFilesystemPath } from "../../../services/infrastructure/explorerApi.js";

export const FILE_EXP_MENU_SLOTS = Object.freeze({
    contextFile: 'file-exp:context-menu:file',
    contextDirectory: 'file-exp:context-menu:directory',
    newMenu: 'file-exp:new-menu'
});

const MENU_CONTRIBUTION_TYPE = 'menu';
const menuModuleCache = new Map();

function normalizePath(value) {
    return String(value || '').trim();
}

function encodeMenuPluginError(plugin, error) {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : 'unknown-plugin';
    const message = error?.message || String(error || 'Unknown error');
    return `[menu plugin:${pluginId}] ${message}`;
}

async function loadMenuContributionModule(plugin) {
    const moduleUrl = typeof plugin?.menuModuleUrl === 'string' ? plugin.menuModuleUrl.trim() : '';
    if (!moduleUrl) {
        throw new Error('Missing menuModuleUrl.');
    }
    if (!menuModuleCache.has(moduleUrl)) {
        menuModuleCache.set(moduleUrl, import(moduleUrl));
    }
    return menuModuleCache.get(moduleUrl);
}

function normalizePluginMenuItems(plugin, slot, context, items) {
    const list = Array.isArray(items) ? items : [];
    const normalized = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const label = typeof item.label === 'string' ? item.label.trim() : '';
        const action = typeof item.action === 'string' ? item.action.trim() : '';
        if (!id || !label || !action) {
            continue;
        }
        normalized.push({
            ...item,
            id,
            label,
            action,
            slot,
            entryPath: typeof item.entryPath === 'string' && item.entryPath.trim()
                ? item.entryPath.trim()
                : normalizePath(context?.selectedPath || ''),
            entryType: typeof item.entryType === 'string' && item.entryType.trim()
                ? item.entryType.trim()
                : String(context?.selectedType || '').trim() || 'file',
            entryName: typeof item.entryName === 'string' && item.entryName.trim()
                ? item.entryName.trim()
                : String(context?.selectedName || '').trim(),
            source: 'plugin',
            pluginId: typeof plugin?.id === 'string' ? plugin.id.trim() : '',
            pluginAgent: typeof plugin?.agent === 'string' ? plugin.agent.trim() : '',
            pluginModuleUrl: typeof plugin?.menuModuleUrl === 'string' ? plugin.menuModuleUrl.trim() : ''
        });
    }
    return normalized;
}

async function getPluginMenuItems(fileExp, slot, context) {
    const plugins = getApplicationPluginsForSlot(slot, { contributionType: MENU_CONTRIBUTION_TYPE });
    if (!plugins.length) {
        return [];
    }

    const collected = [];
    for (const plugin of plugins) {
        try {
            const module = await loadMenuContributionModule(plugin);
            if (typeof module?.getMenuItems !== 'function') {
                continue;
            }
            const items = await module.getMenuItems({ slot, context, plugin });
            collected.push(...normalizePluginMenuItems(plugin, slot, context, items));
        } catch (error) {
            console.error(encodeMenuPluginError(plugin, error));
        }
    }
    return collected;
}

function getNewFileLabel(fileExp) {
    return fileExp.normalizePath(fileExp.state.path || '/') === DPU_SECRETS_PATH
        ? 'New Secret'
        : 'New File';
}

export async function buildFileExpMenuContext(fileExp, slot, target = null) {
    const currentPath = fileExp.normalizePath(fileExp.state.path || '/');
    if (slot === FILE_EXP_MENU_SLOTS.newMenu) {
        return {
            slot,
            currentPath,
            currentDirectory: currentPath,
            currentFsPath: await resolveExplorerPathToFilesystemPath(currentPath),
            isConfidential: isDpuManagedPath(currentPath)
        };
    }

    const entryPath = fileExp.normalizePath(target?.path || fileExp.state.selectedPath || '');
    const entryType = String(target?.type || '').trim().toLowerCase() || 'file';
    const entryName = String(target?.name || (entryPath ? entryPath.split('/').pop() : '') || '').trim();
    return {
        slot,
        currentPath,
        currentFsPath: await resolveExplorerPathToFilesystemPath(currentPath),
        selectedPath: entryPath,
        selectedFsPath: await resolveExplorerPathToFilesystemPath(entryPath),
        selectedName: entryName,
        selectedType: entryType,
        isFile: entryType === 'file',
        isDirectory: entryType === 'directory',
        isConfidential: isDpuManagedPath(entryPath)
    };
}

export function getBuiltInNewMenuItems(fileExp) {
    const currentPath = fileExp.normalizePath(fileExp.state.path || '/');
    const managedByDpu = isDpuManagedPath(currentPath);
    const capabilities = fileExp.state.currentDpuCapabilities || null;
    const allowNewDirectory = managedByDpu ? Boolean(capabilities?.canCreateDirectories) : true;
    const allowNewFile = managedByDpu ? Boolean(capabilities?.canCreateFiles) : true;
    const newFileLabel = getNewFileLabel(fileExp);

    return [
        {
            id: 'host:new-directory',
            source: 'host',
            slot: FILE_EXP_MENU_SLOTS.newMenu,
            action: 'newDirectory',
            label: 'New Folder',
            icon: './assets/icons/folder-with-letter.svg',
            disabled: !allowNewDirectory,
            title: allowNewDirectory ? 'Create folder' : 'Folders are not allowed in this location.'
        },
        {
            id: 'host:new-file',
            source: 'host',
            slot: FILE_EXP_MENU_SLOTS.newMenu,
            action: 'newFile',
            label: newFileLabel,
            icon: './assets/icons/document.svg',
            disabled: !allowNewFile,
            title: allowNewFile
                ? (newFileLabel === 'New Secret' ? 'Create secret' : 'Create file')
                : 'Files are not allowed in this location.'
        }
    ];
}

export function getBuiltInContextMenuItems(fileExp, target) {
    const entryPath = fileExp.normalizePath(target?.path || '');
    const type = String(target?.type || 'file');
    const clipboard = fileExp.state.clipboard || null;
    const isManaged = Boolean(target?.virtualProvider === 'dpu' || isDpuManagedPath(entryPath));
    const canWrite = isManaged ? Boolean(target?.dpuCanWrite) : true;
    const canCreateChildren = isManaged ? Boolean(target?.dpuCanCreateChildren) : true;
    const immutableRoot = isManaged ? Boolean(target?.dpuImmutableRoot) : false;
    const canRename = isManaged
        ? (Object.prototype.hasOwnProperty.call(target || {}, 'dpuCanRename') ? Boolean(target?.dpuCanRename) : (canWrite && !immutableRoot))
        : true;
    const canDelete = isManaged
        ? (Object.prototype.hasOwnProperty.call(target || {}, 'dpuCanDelete') ? Boolean(target?.dpuCanDelete) : (canWrite && !immutableRoot))
        : true;
    const canPasteInto = Boolean(clipboard) && type === 'directory' && (!isManaged || canCreateChildren);

    const items = [
        {
            id: 'host:rename',
            source: 'host',
            slot: type === 'directory' ? FILE_EXP_MENU_SLOTS.contextDirectory : FILE_EXP_MENU_SLOTS.contextFile,
            action: 'renameEntry',
            label: 'Rename',
            entryPath,
            entryType: type,
            icon: './assets/icons/edit.svg',
            disabled: !canRename
        },
        {
            id: 'host:copy',
            source: 'host',
            slot: type === 'directory' ? FILE_EXP_MENU_SLOTS.contextDirectory : FILE_EXP_MENU_SLOTS.contextFile,
            action: 'copyEntry',
            label: 'Copy',
            entryPath,
            entryType: type,
            icon: './assets/icons/copy.svg',
            disabled: isManaged
        },
        {
            id: 'host:cut',
            source: 'host',
            slot: type === 'directory' ? FILE_EXP_MENU_SLOTS.contextDirectory : FILE_EXP_MENU_SLOTS.contextFile,
            action: 'cutEntry',
            label: 'Cut',
            entryPath,
            entryType: type,
            icon: './assets/icons/cut.svg',
            disabled: isManaged
        }
    ];

    if (type === 'file') {
        items.push({
            id: 'host:open-in-new-tab',
            source: 'host',
            slot: FILE_EXP_MENU_SLOTS.contextFile,
            action: 'openEntryInNewTab',
            label: 'Open in new tab',
            entryPath,
            entryType: type,
            icon: './assets/icons/document.svg',
            disabled: false
        });
    }

    if (type === 'directory') {
        items.push(
            {
                id: 'host:open-terminal-here',
                source: 'host',
                slot: FILE_EXP_MENU_SLOTS.contextDirectory,
                action: 'openTerminalHere',
                label: 'Open Terminal Here',
                entryPath,
                entryType: type,
                targetPath: entryPath,
                icon: './assets/icons/terminal.svg',
                disabled: false
            },
            {
                id: 'host:upload-here',
                source: 'host',
                slot: FILE_EXP_MENU_SLOTS.contextDirectory,
                action: 'uploadHere',
                label: 'Upload here',
                entryPath,
                entryType: type,
                targetPath: entryPath,
                icon: './assets/icons/upload.svg',
                disabled: isManaged ? !canCreateChildren : false
            },
            {
                id: 'host:paste-into',
                source: 'host',
                slot: FILE_EXP_MENU_SLOTS.contextDirectory,
                action: 'pasteClipboard',
                label: 'Paste into',
                entryPath,
                entryType: type,
                targetPath: entryPath,
                icon: './assets/icons/paste.svg',
                disabled: !canPasteInto
            }
        );
    }

    if (isManaged && !immutableRoot && canWrite) {
        items.push({
            id: 'host:permissions',
            source: 'host',
            slot: type === 'directory' ? FILE_EXP_MENU_SLOTS.contextDirectory : FILE_EXP_MENU_SLOTS.contextFile,
            action: 'openDpuPermissions',
            label: 'Permissions',
            entryPath,
            entryType: type,
            icon: './assets/icons/keys.svg'
        });
    }

    items.push({
        id: 'host:delete',
        source: 'host',
        slot: type === 'directory' ? FILE_EXP_MENU_SLOTS.contextDirectory : FILE_EXP_MENU_SLOTS.contextFile,
        action: 'deleteEntry',
        label: 'Delete',
        entryPath,
        entryType: type,
        icon: './assets/icons/trash-can.svg',
        destructive: true,
        disabled: !canDelete
    });

    return items;
}

export async function resolveFileExpMenuItems(fileExp, slot, target = null, builtInItems = []) {
    const context = await buildFileExpMenuContext(fileExp, slot, target);
    const pluginItems = await getPluginMenuItems(fileExp, slot, context);
    return [
        ...(Array.isArray(builtInItems) ? builtInItems : []),
        ...pluginItems
    ];
}

export async function executeFileExpMenuItem(fileExp, item, context = null) {
    const pluginId = normalizePath(item?.pluginId);
    const slot = normalizePath(item?.slot);
    if (!pluginId || !slot) {
        return false;
    }
    const plugin = getApplicationPluginsForSlot(slot, { contributionType: MENU_CONTRIBUTION_TYPE })
        .find((entry) => normalizePath(entry?.id) === pluginId);
    if (!plugin) {
        return false;
    }

    const module = await loadMenuContributionModule(plugin);
    if (typeof module?.executeMenuAction !== 'function') {
        return false;
    }

    const effectiveContext = context || await buildFileExpMenuContext(fileExp, slot, {
        path: item?.entryPath || '',
        type: item?.entryType || '',
        name: item?.entryName || ''
    });

    await module.executeMenuAction({
        action: item.action,
        item,
        context: effectiveContext,
        plugin,
        host: {
            refreshDirectory: async () => {
                await fileExp.loadDirectory(fileExp.state.path);
            },
            showStatus: (message, isError = false) => {
                fileExp.showStatus(message, isError);
            }
        }
    });
    return true;
}
