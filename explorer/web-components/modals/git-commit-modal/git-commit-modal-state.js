import { createStore } from "../../../services/ui/store.js";
import { getRememberedGitIdentity, getCredentialsValidated } from "./git-commit-modal-utils.js";
import { getReposRoot } from "../../../utils/reposRoot.js";

export function createGitCommitState(props = {}) {
    const rememberedIdentity = getRememberedGitIdentity();
    const reposRoot = getReposRoot();
    const initialState = {
        // Default to the multi-repo root so opening the modal immediately loads all repos under it.
        repoPath: props.repoPath || reposRoot,
        reposRoot,
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
        credentialsValidated: getCredentialsValidated(),
        pullBlocked: null,
        autoStash: null,
        manualConflicts: [],
        hasConflicts: false,
        conflictCount: 0,
        conflictFocus: false,
        conflictHelper: {
            selected: null,
            ours: '',
            theirs: '',
            status: '',
            loading: false,
            requestKey: null
        },
        identityPrompt: {
            visible: false,
            test:"test",
            repoPath: null,
            pendingAction: null,
            name: rememberedIdentity.name,
            email: rememberedIdentity.email
        },
        authPrompt: {
            visible: false,
            repoPath: null,
            pendingAction: null,
            token: '',
            remember: true
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
        lastStatusLine: '',
        lastStatusIsError: false
    };

    const store = createStore({ initialState });
    return {
        state: store.state,
        dispatch: store.dispatch,
        subscribe: store.subscribe,
        getState: store.getState,
        getSelectedReposForBatch: () => getSelectedReposForBatch(store.getState())
    };
}
export function getSelectedReposForBatch(state) {
    return Array.from(new Set([
        ...Object.entries(state.selectedFilesByRepo || {})
            .filter(([, entry]) => (entry?.files && entry.files.size > 0) || (entry?.prefixes && entry.prefixes.size > 0))
            .map(([repoPath]) => repoPath)
    ]));
}
