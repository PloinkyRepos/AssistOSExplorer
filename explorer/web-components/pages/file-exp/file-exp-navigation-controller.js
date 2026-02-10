import { FILE_EXP_UI_ACTIONS } from "./file-exp-ui-controller.js";
import { PREVIEW_ACTIONS } from "./file-exp-preview-controller.js";

export async function loadStateFromURL(fileExp) {
    const rawPath = window.location.hash.split('#file-exp')[1] || '/';
    let path = rawPath;
    try {
        path = decodeURIComponent(rawPath);
    } catch (error) {
        console.warn('Failed to decode file-exp path from URL:', rawPath, error);
        path = rawPath;
    }
    path = fileExp.normalizePath(path);

    if (path === '/') {
        await fileExp.loadDirectory('/');
        return;
    }

    if (fileExp.state.isEditing) {
        await fileExp.cancelEdit();
    }

    const parentDir = fileExp.parentPath(path) || '/';
    const entryName = path.substring(parentDir.length).replace(/^\//, '');

    try {
        const parentEntries = await fileExp.loadDirectoryContent(parentDir);
        if (parentEntries === null) {
            fileExp.showStatus('Path not found. Returning to root.', true);
            await fileExp.loadDirectory('/');
            return;
        }

        const entry = parentEntries.find((item) => item.name === entryName);
        if (!entry) {
            await fileExp.loadDirectory(path);
            return;
        }

        if (entry.type === 'file') {
            fileExp.state.path = parentDir;
            fileExp.state.selectedPath = path;
            fileExp.state.isEditing = false;
            await fileExp.setEntries(parentEntries);
            await fileExp.openFile(path);
            const newUrl = `#file-exp${path}`;
            if (window.location.hash !== newUrl) {
                history.pushState(null, '', newUrl);
            }
            fileExp.invalidate();
            return;
        }

        if (entry.type === 'directory') {
            await fileExp.loadDirectory(path);
            return;
        }

        fileExp.showStatus(`Unsupported entry type for ${path}.`, true);
        await fileExp.loadDirectory(parentDir);
    } catch (error) {
        console.error('Failed to load state from URL:', error);
        fileExp.showStatus('An error occurred while loading the path. Returning to root.', true);
        await fileExp.loadDirectory('/');
    }
}

export async function loadDirectory(fileExp, path = fileExp.state.path) {
    await fileExp.withLoader(async () => {
        if (fileExp.state.isEditing) {
            await fileExp.cancelEdit();
        }
        const normalizedPath = fileExp.normalizePath(path);
        fileExp.state.path = normalizedPath;

        const newUrl = `#file-exp${normalizedPath}`;
        if (window.location.hash !== newUrl) {
            history.pushState(null, '', newUrl);
        }

        fileExp.dispatchUi({ type: FILE_EXP_UI_ACTIONS.RESET_DIRECTORY_CONTEXT });
        fileExp.dispatchPreview({ type: PREVIEW_ACTIONS.RESET });
        fileExp.pendingMenuFocusPath = null;

        const entries = await fileExp.loadDirectoryContent(fileExp.state.path);
        if (entries === null) {
            if (fileExp.state.path === '/') {
                fileExp.showStatus('Root directory is not accessible.', true);
                return;
            }
            fileExp.showStatus('Path not found. Returning to root.', true);
            await fileExp.loadDirectory('/');
            return;
        }
        await fileExp.setEntries(entries);
        fileExp.invalidate();
    });

    if (String(fileExp.state.directoryFilterQuery || '').trim().length >= 2) {
        await fileExp.directoryFilterController.rerunIfActive();
    }
}

export async function refreshDirectory(fileExp) {
    await fileExp.withLoader(async () => {
        const currentPath = fileExp.state.path || '/';
        fileExp.caches.dirListing.invalidate(fileExp, currentPath);
        const entries = await fileExp.loadDirectoryContent(currentPath);
        if (entries === null) {
            fileExp.showStatus('Path not found. Returning to root.', true);
            await fileExp.loadDirectory('/');
            return;
        }
        await fileExp.setEntries(entries);
        fileExp.invalidate();
    });

    if (String(fileExp.state.directoryFilterQuery || '').trim().length >= 2) {
        await fileExp.directoryFilterController.rerunIfActive();
    }
}

export function renderBreadcrumbs(fileExp) {
    const breadcrumbsEl = fileExp.element.querySelector('#breadcrumbs');
    breadcrumbsEl.innerHTML = '';

    const rootButton = document.createElement('button');
    rootButton.textContent = '/';
    rootButton.addEventListener('click', () => {
        fileExp.loadDirectory('/');
    });
    breadcrumbsEl.appendChild(rootButton);

    if (!fileExp.state.path || fileExp.state.path === '/') return;

    const segments = fileExp.state.path.split('/').filter(Boolean);
    let current = '';
    segments.forEach((segment) => {
        current += `/${segment}`;
        const btn = document.createElement('button');
        btn.textContent = `${segment} /`;
        const path = current;
        btn.addEventListener('click', () => {
            fileExp.loadDirectory(path);
        });
        breadcrumbsEl.appendChild(btn);
    });
}

export async function goUpDirectory(fileExp) {
    const parent = fileExp.parentPath(fileExp.state.path);
    if (parent !== null) {
        await fileExp.loadDirectory(parent);
    }
}
