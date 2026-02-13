export function attachTasksController(fileExp) {
    const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');

    const resolveCurrentFolder = () => normalize(fileExp.state.path || '/') || '/';

    const listBacklogFilesInCurrentFolder = async (folderPath) => {
        const entries = await fileExp.loadDirectoryContent(folderPath);
        if (!Array.isArray(entries)) {
            return [];
        }
        return entries
            .filter((entry) => entry?.type === 'file')
            .map((entry) => fileExp.normalizePath(entry.path || fileExp.joinPath(folderPath, entry.name || '')))
            .filter((fullPath) => fullPath.endsWith('.backlog') || fullPath.endsWith('.history'));
    };

    const applyBacklogFilterResult = async (folderPath, backlogFiles, preferredPath = '') => {
        const entries = backlogFiles.map((fullPath) => ({
            name: fullPath.split('/').pop() || fullPath,
            path: fullPath,
            type: 'file',
            size: null,
            modified: null
        }));

        fileExp.state.path = folderPath;
        fileExp.state.entries = fileExp.sortEntries(entries);
        fileExp.state.allEntries = fileExp.state.entries;
        fileExp.renderEntries();
        fileExp.setPreviewState({ backlogTextView: false }, { invalidate: false });

        const normalizedPreferred = preferredPath ? fileExp.normalizePath(preferredPath) : '';
        const selectedPath = normalizedPreferred && backlogFiles.includes(normalizedPreferred)
            ? normalizedPreferred
            : (backlogFiles.length === 1 ? backlogFiles[0] : '');

        fileExp.state.selectedPath = selectedPath;
        if (selectedPath) {
            await fileExp.openFile(selectedPath);
            history.pushState(null, '', `#file-exp${selectedPath}`);
        }
    };

    async function showAllBacklogs() {
        return fileExp.withLoader(async () => {
            const currentFolder = resolveCurrentFolder();
            let backlogFiles = [];
            try {
                backlogFiles = await listBacklogFilesInCurrentFolder(currentFolder);
            } catch {
                backlogFiles = [];
            }

            if (!backlogFiles.length) {
                fileExp.showStatus('No backlog files found in current folder.', true);
                return;
            }

            await applyBacklogFilterResult(currentFolder, backlogFiles);
            if (backlogFiles.length > 1) {
                fileExp.showStatus('Showing all backlog files in current folder.', false);
            }
        });
    }

    async function newBacklog() {
        return fileExp.withLoader(async () => {
            const currentFolder = resolveCurrentFolder();
            const payload = await assistOS.UI.createReactiveModal('backlog-create-file-modal', {}, true);
            const rawName = String(payload?.filename || '').trim();
            if (!rawName) {
                return;
            }

            const fileName = rawName.endsWith('.backlog') ? rawName : `${rawName}.backlog`;
            const backlogPath = fileExp.joinPath(currentFolder, fileName);

            try {
                await fileExp.tooling.writeFile(backlogPath, JSON.stringify([], null, 2));
                fileExp.bumpWorkspaceVersion?.();
            } catch {
                fileExp.showStatus('Failed to create backlog file in current folder.', true);
                return;
            }

            fileExp.caches?.dirListing?.invalidate?.(fileExp, currentFolder);
            let backlogFiles = [];
            try {
                backlogFiles = await listBacklogFilesInCurrentFolder(currentFolder);
            } catch {
                backlogFiles = [];
            }
            const normalizedPath = fileExp.normalizePath(backlogPath);
            if (!backlogFiles.includes(normalizedPath)) {
                backlogFiles.unshift(normalizedPath);
            }

            await applyBacklogFilterResult(currentFolder, Array.from(new Set(backlogFiles)), normalizedPath);
            fileExp.showStatus(`Created ${fileName}.`, false);
        });
    }

    async function openBacklog() {
        return showAllBacklogs();
    }

    Object.assign(fileExp, {
        openBacklog,
        newBacklog,
        showAllBacklogs
    });
}
