import fs from "node:fs/promises";
import path from "node:path";

export const EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", "agents", "blobs", "logs", "shared"]);
export const PLOINKY_REPOS_DIR = path.join(".ploinky", "repos");

export const pickWorkspaceRoot = async ({
    fsModule = fs,
    pathModule = path,
    env = process.env,
    cwd = () => process.cwd(),
    logger = () => {}
} = {}) => {
    const currentWorkingDirectory = cwd();
    const configuredRoot = env.SOPLANG_WORKSPACE_ROOT;
    const ploinkyWorkspaceRoot = env.PLOINKY_CWD;

    if (configuredRoot) {
        logger(`[workspaceRoots] Checking SOPLANG_WORKSPACE_ROOT: ${configuredRoot}`);
        try {
            const stat = await fsModule.stat(configuredRoot);
            if (stat.isDirectory()) {
                logger(`[workspaceRoots] Using SOPLANG_WORKSPACE_ROOT: ${configuredRoot}`);
                return configuredRoot;
            }
        } catch (error) {
            throw new Error(`SOPLANG_WORKSPACE_ROOT is set but invalid: ${configuredRoot} (${error.message})`);
        }

        throw new Error(`SOPLANG_WORKSPACE_ROOT is set but is not a directory: ${configuredRoot}`);
    }

    if (ploinkyWorkspaceRoot) {
        logger(`[workspaceRoots] Checking PLOINKY_CWD: ${ploinkyWorkspaceRoot}`);
        try {
            const stat = await fsModule.stat(ploinkyWorkspaceRoot);
            if (stat.isDirectory()) {
                logger(`[workspaceRoots] Using PLOINKY_CWD: ${ploinkyWorkspaceRoot}`);
                return ploinkyWorkspaceRoot;
            }
        } catch (_) {
            // Ignore invalid PLOINKY_CWD and continue with cwd fallback.
        }
    }

    const candidates = [
        { label: "cwd", value: currentWorkingDirectory },
        { label: "cwd/..", value: pathModule.resolve(currentWorkingDirectory, "..") },
        { label: "cwd/../..", value: pathModule.resolve(currentWorkingDirectory, "../..") }
    ];

    for (const { label, value } of candidates) {
        logger(`[workspaceRoots] Checking ${label}: ${value}`);
        try {
            const stat = await fsModule.stat(value);
            if (stat.isDirectory()) {
                logger(`[workspaceRoots] Selected ${label}: ${value}`);
                return value;
            }
        } catch (_) {
            // Ignore invalid candidates and continue.
        }
    }

    throw new Error(`No valid workspace root found from cwd fallback chain starting at ${currentWorkingDirectory}`);
};

export const walkMarkdownFiles = async (root, {
    fsModule = fs,
    pathModule = path,
    excludeDirs = EXCLUDE_DIRS
} = {}) => {
    const files = [];
    const stack = [root];
    const visited = new Set();
    const ploinkyReposPath = pathModule.join(root, PLOINKY_REPOS_DIR);
    const rootPloinkyPath = pathModule.join(root, ".ploinky");

    const resolveVisitKey = async (targetPath) => {
        try {
            return await fsModule.realpath(targetPath);
        } catch (_) {
            return pathModule.resolve(targetPath);
        }
    };

    while (stack.length) {
        const current = stack.pop();
        const visitKey = await resolveVisitKey(current);
        if (visited.has(visitKey)) {
            continue;
        }
        visited.add(visitKey);
        let entries = [];
        try {
            entries = await fsModule.readdir(current, { withFileTypes: true });
        } catch (_) {
            continue;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const childPath = pathModule.join(current, entry.name);
                if (current === root && childPath === rootPloinkyPath) {
                    try {
                        const reposStat = await fsModule.stat(ploinkyReposPath);
                        if (reposStat.isDirectory()) {
                            stack.push(ploinkyReposPath);
                        }
                    } catch (_) {
                        // Ignore missing .ploinky/repos and continue.
                    }
                    continue;
                }
                if (excludeDirs.has(entry.name)) {
                    continue;
                }
                stack.push(childPath);
                continue;
            }

            if (entry.isFile() && entry.name.endsWith(".md")) {
                files.push(pathModule.join(current, entry.name));
            }
        }
    }

    return files;
};
