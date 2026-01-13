export function createGitCommitState(props = {}) {
    const state = {
        // Default to the multi-repo root so opening the modal immediately loads all repos under it.
        repoPath: props.repoPath || '/.ploinky/repos',
        reposRoot: '/.ploinky/repos',
        branch: null,
        upstream: null,
        remotes: [],
        repoInfoOk: null,
        repoOverviews: [],
        repoOverviewsLoading: false,
        repoTreeExpanded: {},
        repoChangesExpanded: {},
        treeExpandedByRepo: {},
        selectedFilesByRepo: {},
        selectedRepoPath: null,
        selectedPath: null,
        selectedSection: null, // 'staged' | 'unstaged' | 'untracked' | 'conflicted'
        commitMessage: '',
        commitMode: 'commit', // 'commit' | 'commitPush'
        actionsMenuOpen: false,
        pullMode: 'ffOnly', // 'ffOnly' | 'rebase' | 'merge'
        credentialsOpen: false,
        credentialsGate: false,
        identityPrompt: {
            visible: false,
            repoPath: null,
            pendingAction: null,
            name: '',
            email: ''
        },
        authPrompt: {
            visible: false,
            repoPath: null,
            pendingAction: null,
            token: '',
            remember: false
        },
        ignorePrompt: {
            visible: false,
            repoPath: null,
            mode: 'file', // 'file' | 'folder'
            anchor: true,
            patterns: '',
            paths: [],
            source: 'manual', // 'selection' | 'untracked' | 'manual'
            stopTracking: false
        },
        lastStatusLine: ''
    };

    return {
        state,
        getSelectedReposForBatch: () => getSelectedReposForBatch(state)
    };
}

export function getSelectedReposForBatch(state) {
    return Array.from(new Set([
        ...Object.entries(state.selectedFilesByRepo || {})
            .filter(([, entry]) => (entry?.files && entry.files.size > 0) || (entry?.prefixes && entry.prefixes.size > 0))
            .map(([repoPath]) => repoPath)
    ]));
}
