import { callAgentTool, callExplorerTool, parseToolResult } from "../../../services/infrastructure/explorerApi.js";
import { getReposRoot } from "../../../utils/reposRoot.js";

export function attachTasksController(fileExp) {
    const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');

    const pickRepoRoot = (currentDir, repos) => {
        const normalizedDir = normalize(currentDir);
        let best = '';
        for (const repoPath of repos) {
            const normalizedRepo = normalize(repoPath);
            if (!normalizedRepo) continue;
            if (normalizedDir === normalizedRepo || normalizedDir.startsWith(`${normalizedRepo}/`)) {
                if (!best || normalizedRepo.length > best.length) {
                    best = normalizedRepo;
                }
            }
        }
        return best;
    };

    async function getRepoList() {
        let repos = [];
        try {
            const reposRoot = getReposRoot();
            const raw = await callAgentTool('gitAgent', 'git_repos_overview', { path: reposRoot }, { raw: true });
            const payload = parseToolResult(raw) || {};
            repos = Array.isArray(payload?.repos) ? payload.repos.map((repo) => repo?.path).filter(Boolean) : [];
        } catch {
            repos = [];
        }
        return repos;
    }

    const searchBacklogFiles = async (repoRoot) => {
        const text = await callExplorerTool('search_files', {
            path: repoRoot,
            pattern: '.backlog',
            excludePatterns: ['.git', '.ploinky', 'node_modules']
        });
        const lines = String(text || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.toLowerCase().includes('no matches'));
        return lines
            .map((line) => (line.startsWith('/') ? line : `/${line}`))
            .map((fullPath) => fileExp.normalizePath(fullPath))
            .filter((fullPath) => fullPath.endsWith('.backlog'));
    };

    async function openBacklog() {
        return fileExp.withLoader(async () => {
            const currentDir = fileExp.state.path || '/';
            const repoList = await getRepoList();
            const repoRoot = pickRepoRoot(currentDir, repoList) || normalize(currentDir) || '/';
            let backlogFiles = [];
            try {
                backlogFiles = await searchBacklogFiles(repoRoot);
            } catch {
                backlogFiles = [];
            }
            if (!backlogFiles.length) {
                const payload = await assistOS.UI.createReactiveModal('backlog-create-file-modal', {}, true);
                const rawName = String(payload?.filename || '').trim();
                if (!rawName) {
                    fileExp.showStatus('No backlog files found in this repo.', true);
                    return;
                }
                const fileName = rawName.endsWith('.backlog') ? rawName : `${rawName}.backlog`;
                const backlogPath = fileExp.joinPath(repoRoot, fileName);
                try {
                    await fileExp.tooling.writeFile(backlogPath, JSON.stringify([], null, 2));
                    backlogFiles = [backlogPath];
                } catch {
                    fileExp.showStatus('Failed to create backlog file in this repo.', true);
                    return;
                }
            }
            const entries = backlogFiles.map((fullPath) => ({
                name: fullPath.split('/').pop() || fullPath,
                path: fullPath,
                type: 'file',
                size: null,
                modified: null
            }));
            fileExp.state.path = repoRoot;
            fileExp.state.entries = fileExp.sortEntries(entries);
            fileExp.state.allEntries = fileExp.state.entries;
            fileExp.renderEntries();
            fileExp.state.selectedPath = backlogFiles.length === 1 ? backlogFiles[0] : '';
            if (backlogFiles.length === 1) {
                await fileExp.openFile(backlogFiles[0]);
                history.pushState(null, '', `#file-exp${backlogFiles[0]}`);
            } else {
                fileExp.showStatus('Showing all .backlog files in this repo.', false);
            }
        });
    }

    Object.assign(fileExp, {
        openBacklog
    });
}
