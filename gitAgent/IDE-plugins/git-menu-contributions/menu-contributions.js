import { callAgentTool, parseToolResult } from "/explorer/services/infrastructure/explorerApi.js";

async function callGitTool(name, args) {
    const raw = await callAgentTool('gitAgent', name, args, { raw: true });
    return parseToolResult(raw);
}

function normalizeRepositoryName(value) {
    return String(value || '').trim();
}

async function openNewRepositoryModal(basePath) {
    const result = await assistOS.UI.showModal('git-new-repository-modal', { basePath }, true);
    if (!result || typeof result !== 'object') {
        return null;
    }
    return {
        name: normalizeRepositoryName(result.name),
        remote: String(result.remote || 'origin').trim(),
        remoteUrl: String(result.remoteUrl || '').trim()
    };
}

function shouldOfferAddToGitignore(context) {
    if (!context || context.isConfidential) {
        return false;
    }
    if (!context.selectedPath || !context.selectedName) {
        return false;
    }
    if (context.selectedName === '.gitignore') {
        return false;
    }
    return context.isFile || context.isDirectory;
}

function getRepoProbePath(context) {
    const selectedPath = String(context?.selectedFsPath || context?.selectedPath || '').trim();
    if (!selectedPath) {
        return '';
    }
    return selectedPath;
}

export async function getMenuItems({ context, plugin }) {
    if (context?.slot === 'file-exp:new-menu') {
        if (context?.isConfidential || !context?.currentFsPath) {
            return [];
        }
        return [{
            id: 'git:new-repository',
            label: 'New repository',
            icon: plugin?.icon || '',
            action: 'new-repository'
        }];
    }

    if (!shouldOfferAddToGitignore(context)) {
        return [];
    }

    const selectedPath = getRepoProbePath(context);
    if (!selectedPath) {
        return [];
    }

    const repoInfo = await callGitTool('git_info', { path: selectedPath });
    if (!repoInfo?.ok || !repoInfo.repoPath || !repoInfo.repoRelativePath) {
        return [];
    }

    const ignorePayload = await callGitTool('git_check_ignore', {
        path: repoInfo.repoPath,
        files: [repoInfo.repoRelativePath]
    });
    const isIgnored = Array.isArray(ignorePayload?.matches) && ignorePayload.matches.length > 0;

    return [{
        id: isIgnored ? 'git:remove-from-gitignore' : 'git:add-to-gitignore',
        label: isIgnored ? 'Remove from .gitignore' : 'Add to .gitignore',
        icon: plugin?.icon || '',
        action: isIgnored ? 'remove-from-gitignore' : 'add-to-gitignore'
    }];
}

export async function executeMenuAction({ action, context, host }) {
    if (action === 'new-repository') {
        const basePath = String(context?.currentFsPath || context?.currentDirectory || context?.currentPath || '').trim();
        if (!basePath) {
            throw new Error('Missing target directory for repository creation.');
        }
        const modalResult = await openNewRepositoryModal(basePath);
        if (!modalResult) {
            return;
        }
        const repoName = modalResult.name;
        if (!repoName) {
            throw new Error('Repository name is required.');
        }
        if (!modalResult.remoteUrl) {
            throw new Error('Remote URL is required.');
        }
        const result = await callGitTool('git_init_repository', {
            path: basePath,
            name: repoName,
            remote: modalResult.remote || 'origin',
            remoteUrl: modalResult.remoteUrl
        });
        if (!result?.ok) {
            throw new Error(result?.error || 'Failed to create repository.');
        }
        host?.showStatus?.(`Created repository: ${result.name || repoName} with ${result.remote || modalResult.remote || 'origin'}.`);
        await host?.refreshDirectory?.();
        return;
    }

    const targetPath = String(context?.selectedFsPath || context?.selectedPath || '').trim();
    if (!targetPath) {
        throw new Error('Missing target path for gitignore action.');
    }
    if (action === 'add-to-gitignore') {
        const result = await callGitTool('git_add_ignore', { path: targetPath });
        if (!result?.ok) {
            throw new Error(result?.error || 'Failed to update .gitignore.');
        }

        const added = Array.isArray(result.added) ? result.added : [];
        const alreadyPresent = Array.isArray(result.alreadyPresent) ? result.alreadyPresent : [];
        if (added.length) {
            host?.showStatus?.(`Added ${added[0]} to .gitignore.`);
        } else if (alreadyPresent.length) {
            host?.showStatus?.(`${alreadyPresent[0]} is already in .gitignore.`);
        } else {
            host?.showStatus?.('Updated .gitignore.');
        }
    } else if (action === 'remove-from-gitignore') {
        const result = await callGitTool('git_remove_ignore', { path: targetPath });
        if (!result?.ok) {
            throw new Error(result?.error || 'Failed to update .gitignore.');
        }
        if (result.removed && result.retracked) {
            host?.showStatus?.('Removed from .gitignore and restored tracking.');
        } else if (result.removed) {
            host?.showStatus?.('Removed from .gitignore.');
        } else {
            host?.showStatus?.('No ignore rule was found.');
        }
    } else {
        return;
    }
    await host?.refreshDirectory?.();
}
