export function attachTasksController(fileExp) {
    const backlogPath = fileExp.joinPath('/', '.backlog');

    async function openBacklog() {
        return fileExp.withLoader(async () => {
            try {
                await fileExp.tooling.readTextFile(backlogPath);
            } catch (error) {
                fileExp.showStatus('Backlog not found. Create .backlog in workspace root.', true);
                return;
            }
            const parentDir = fileExp.parentPath(backlogPath) || '/';
            fileExp.state.path = parentDir;
            const entries = await fileExp.loadDirectoryContent(parentDir);
            await fileExp.setEntries(entries);
            fileExp.state.selectedPath = backlogPath;
            await fileExp.openFile(backlogPath);
            history.pushState(null, '', `#file-exp${backlogPath}`);
        });
    }

    Object.assign(fileExp, {
        openBacklog
    });
}
