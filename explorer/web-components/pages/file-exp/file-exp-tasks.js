import { callAgentTool, parseToolResult } from "../../../services/infrastructure/explorerApi.js";
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

    async function ensureRepoBacklogs() {
        let repos = [];
        try {
            const reposRoot = getReposRoot();
            const raw = await callAgentTool('gitAgent', 'git_repos_overview', { path: reposRoot }, { raw: true });
            const payload = parseToolResult(raw) || {};
            repos = Array.isArray(payload?.repos) ? payload.repos.map((repo) => repo?.path).filter(Boolean) : [];
        } catch {
            repos = [];
        }
        for (const repoPath of repos) {
            const normalizedRepo = normalize(repoPath);
            if (!normalizedRepo) continue;
            const backlogPath = fileExp.joinPath(normalizedRepo, '.backlog');
            try {
                await fileExp.tooling.readTextFile(backlogPath);
            } catch {
                try {
                    await fileExp.tooling.writeFile(backlogPath, '');
                } catch {
                    // ignore per-repo create errors
                }
            }
        }
        return repos;
    }

    async function openBacklog() {
        return fileExp.withLoader(async () => {
            const currentDir = fileExp.state.path || '/';
            const repoList = await ensureRepoBacklogs();
            const repoRoot = pickRepoRoot(currentDir, repoList) || normalize(currentDir) || '/';
            const backlogPath = fileExp.joinPath(repoRoot, '.backlog');
            try {
                await fileExp.tooling.readTextFile(backlogPath);
            } catch (error) {
                try {
                    await fileExp.tooling.writeFile(backlogPath, '');
                } catch (createError) {
                    fileExp.showStatus('Backlog not found. Create .backlog in repo root.', true);
                    return;
                }
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
