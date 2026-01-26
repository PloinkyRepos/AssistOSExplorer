import {
    normalizeErrorMessage,
    parseJsonToolResult,
    isReposRootPath,
    isGitAuthError,
    isGitIdentityError,
    isGitConflictError,
    isGitPullBlockedError,
    getRememberedGitPat,
    getRememberedGitIdentity,
    setRememberedGitPat,
    setRememberedGitIdentity,
    setAutocommitSettings,
    getConflictAutoresolveSetting,
    setConflictAutoresolveSetting,
    setCredentialsValidated
} from "./git-commit-modal-utils.js";

export function createCredentialsActions(ctx) {
    const {
        getState,
        applyState,
        service,
        setStatusLine,
        updateCommitButtons,
        updateIdentityPrompt,
        updateAuthPrompt,
        refreshAll,
        pullRepos,
        pullSelectedRepos,
        push,
        pushRepos,
        commitSelectedRepos,
        getSelectedReposForBatch,
        reposRoot
    } = ctx;

    const resolveIdentityRepoPath = async () => {
        const state = getState();
        const selectedRepo = state.selectedRepoPath;
        if (selectedRepo && !isReposRootPath(selectedRepo, state.reposRoot)) return selectedRepo;
        if (state.repoPath && !isReposRootPath(state.repoPath, state.reposRoot)) return state.repoPath;
        const selected = getSelectedReposForBatch();
        if (selected.length) return selected[0];
        try {
            const payload = parseJsonToolResult(await service.gitReposOverview(state.reposRoot)) || {};
            const repos = Array.isArray(payload.repos) ? payload.repos : [];
            const first = repos.map((repo) => repo?.path).find(Boolean);
            if (first) return first;
        } catch {
            // ignore
        }
        return '';
    };

    const showGitAuthPrompt = (repoPath, pendingAction, { message = '' } = {}) => {
        const remembered = getRememberedGitPat();
        applyState({
            authPrompt: {
                visible: true,
                repoPath,
                pendingAction: pendingAction || null,
                token: '',
                remember: Boolean(remembered)
            }
        });
        updateAuthPrompt({ focus: 'token' });
        updateCommitButtons();
        setStatusLine(
            message || (remembered ? 'A token is already saved. Paste a new token to replace it.' : 'Authentication required to push.'),
            true
        );
    };

    const openGitTokenPrompt = () => {
        const state = getState();
        showGitAuthPrompt(state.repoPath, null, { message: '' });
    };

    const openGitIdentityPrompt = async () => {
        const state = getState();
        const repoPath = await resolveIdentityRepoPath();
        if (!repoPath) {
            setStatusLine('Select a repository to set identity.', true);
            return;
        }

        const remembered = getRememberedGitIdentity();
        const name = remembered.name || state.identityPrompt?.name || '';
        const email = remembered.email || state.identityPrompt?.email || '';
        applyState({
            identityPrompt: {
                visible: true,
                repoPath,
                pendingAction: null,
                name,
                email
            }
        });
        updateIdentityPrompt({ focus: !name ? 'name' : (!email ? 'email' : 'name') });
        updateCommitButtons();
    };

    const cancelGitToken = () => {
        const state = getState();
        applyState({
            authPrompt: { visible: false, repoPath: null, pendingAction: null, token: '', remember: false },
            credentialsOpen: state.credentialsOpen && !state.credentialsGate ? false : state.credentialsOpen
        });
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
    };

    const cancelGitIdentity = () => {
        const state = getState();
        if (state.credentialsGate) {
            applyState({
                identityPrompt: {
                    ...state.identityPrompt,
                    visible: true
                }
            });
            updateIdentityPrompt({ focus: state.identityPrompt?.name ? 'email' : 'name' });
            updateCommitButtons();
            setStatusLine('Set name and email to continue.', true);
            return;
        }
        applyState({
            identityPrompt: { visible: false, repoPath: null, pendingAction: null, name: '', email: '' },
            credentialsOpen: state.credentialsOpen && !state.credentialsGate ? false : state.credentialsOpen
        });
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
    };

    const cancelGitCredentials = () => {
        const state = getState();
        const rememberedIdentity = getRememberedGitIdentity();
        const rememberedToken = getRememberedGitPat();
        const hasSavedIdentity = Boolean(String(rememberedIdentity.name || '').trim() && String(rememberedIdentity.email || '').trim());
        const hasSavedToken = Boolean(String(rememberedToken || '').trim());
        const hasAllSaved = hasSavedIdentity && hasSavedToken;
        if (state.credentialsGate && hasAllSaved) {
            applyState({
                identityPrompt: {
                    ...state.identityPrompt,
                    visible: true
                }
            });
            updateIdentityPrompt({ focus: state.identityPrompt?.name ? 'email' : 'name' });
            updateCommitButtons();
            setStatusLine('Set name and email to continue.', true);
            return false;
        }
        applyState({
            identityPrompt: { visible: false, repoPath: null, pendingAction: null, name: '', email: '' },
            authPrompt: { visible: false, repoPath: null, pendingAction: null, token: '', remember: false },
            credentialsOpen: state.credentialsOpen ? false : state.credentialsOpen,
            credentialsGate: state.credentialsGate && !hasAllSaved ? false : state.credentialsGate
        });
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
        if (!hasAllSaved) {
            return true;
        }
        return false;
    };

    const saveGitToken = async (payload = {}) => {
        const state = getState();
        const pending = state.authPrompt?.pendingAction;
        const token = String(payload.token ?? state.authPrompt?.token ?? '').trim();
        const remember = typeof payload.remember === 'boolean' ? payload.remember : Boolean(state.authPrompt?.remember);
        applyState({
            authPrompt: {
                ...state.authPrompt,
                token,
                remember
            }
        }, { silent: true });
        if (!token) {
            applyState({
                authPrompt: {
                    ...state.authPrompt,
                    visible: true,
                    token: '',
                    remember
                }
            });
            updateAuthPrompt({ focus: 'token' });
            updateCommitButtons();
            setStatusLine('Enter a token to continue.', true);
            return;
        }
        if (remember) setRememberedGitPat(token);
        else setRememberedGitPat('');

        applyState({
            authPrompt: { visible: false, repoPath: null, pendingAction: null, token: '', remember: false }
        });
        updateCommitButtons();
        setStatusLine(pending?.type === 'pull' ? 'Retrying pull…' : 'Retrying push…');
        try {
            if (pending?.type === 'push') {
                if (pending.mode === 'batch') {
                    const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                    await pushRepos(list, { token });
                } else {
                    await push({ silent: false, token });
                }
            } else if (pending?.type === 'pull') {
                const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                await pullRepos(list, { token });
            }
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
        }
    };

    const saveGitCredentials = async (payload = {}) => {
        const state = getState();
        const name = String(payload.name ?? state.identityPrompt?.name ?? '').trim();
        const email = String(payload.email ?? state.identityPrompt?.email ?? '').trim();
        const token = String(payload.token ?? state.authPrompt?.token ?? '').trim();
        const remember = typeof payload.remember === 'boolean' ? payload.remember : Boolean(state.authPrompt?.remember);
        const validateOnly = Boolean(payload.validateOnly);
        const autocommitIntervalMinutes = payload.autocommitIntervalMinutes;
        const autocommitRepos = Array.isArray(payload.autocommitRepos) ? payload.autocommitRepos : null;
        const autoresolveConflicts = typeof payload.autoresolveConflicts === 'boolean'
            ? payload.autoresolveConflicts
            : getConflictAutoresolveSetting();

        const identityRequired = Boolean(state.credentialsGate || state.identityPrompt?.visible);
        const authRequired = Boolean(state.authPrompt?.visible);
        const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        const identityValid = Boolean(name && email && emailPattern.test(email));
        const tokenRequired = remember || authRequired;
        const tokenValid = !tokenRequired || Boolean(token);

        applyState({
            identityPrompt: {
                ...state.identityPrompt,
                name,
                email
            },
            authPrompt: {
                ...state.authPrompt,
                token,
                remember
            }
        }, { silent: true });

        if (!identityValid) {
            applyState({
                identityPrompt: {
                    ...state.identityPrompt,
                    visible: true,
                    name,
                    email
                }
            });
            updateIdentityPrompt({ focus: !name ? 'name' : 'email' });
            updateCommitButtons();
            setStatusLine(!name || !email ? 'Enter name and email.' : 'Enter a valid email address.', true);
            return;
        }
        if (!remember) {
            setRememberedGitPat('');
        }
        if (tokenRequired && !tokenValid) {
            applyState({
                authPrompt: {
                    ...state.authPrompt,
                    visible: true,
                    token: '',
                    remember
                }
            });
            updateAuthPrompt({ focus: 'token' });
            updateCommitButtons();
            setStatusLine('Enter a token to continue.', true);
            return;
        }

        if (!state.credentialsValidated && !state.credentialsDirty && (state.autocommitDirty || state.autoresolveDirty) && !validateOnly) {
            setAutocommitSettings({ intervalMinutes: autocommitIntervalMinutes, repos: autocommitRepos });
            setConflictAutoresolveSetting(autoresolveConflicts);
            try {
                window.dispatchEvent(new CustomEvent('webskel-autocommit-settings-changed'));
            } catch {
                // ignore dispatch errors
            }
            applyState({
                autocommitDirty: false,
                autocommitDraft: {
                    intervalMinutes: autocommitIntervalMinutes,
                    repos: autocommitRepos
                },
                autoresolveDirty: false,
                autoresolveDraft: { enabled: autoresolveConflicts }
            });
            updateCommitButtons();
            setStatusLine('Settings saved.');
            return;
        }

        if (!state.credentialsValidated && !(validateOnly || tokenRequired || token)) {
            setCredentialsValidated(false);
        } else if (!state.credentialsValidated) {
            let validationRepoPath = state.identityPrompt?.repoPath || state.authPrompt?.repoPath;
            if (!validationRepoPath) {
                validationRepoPath = await resolveIdentityRepoPath();
            }
            if (!validationRepoPath) {
                validationRepoPath = state.reposRoot || state.repoPath || '';
            }
            if (!validationRepoPath) {
                setStatusLine('Select a repository to validate credentials.', true);
                return;
            }
            if (!token) {
                setStatusLine('Enter a token to validate credentials.', true);
                return;
            }
            setStatusLine('Validating credentials...');
            try {
                await service.gitPull({ path: validationRepoPath, rebase: false, ffOnly: false, token });
            } catch (error) {
                const msg = normalizeErrorMessage(error);
                const lower = msg.toLowerCase();
                if (isGitAuthError(msg) || lower.includes('repository not found')) {
                    setStatusLine('Token validation failed. Check your token and repo access.', true);
                    return;
                }
                if (lower.includes('remote is not https')) {
                    setStatusLine(msg, true);
                    return;
                }
                if (isGitIdentityError(msg)) {
                    setStatusLine('Author identity is not valid for git. Update name/email and retry.', true);
                    return;
                }
                if (!isGitPullBlockedError(msg) && !isGitConflictError(msg)) {
                    setStatusLine(msg || 'Unable to validate credentials.', true);
                    return;
                }
            }
            applyState({ credentialsValidated: true });
            setCredentialsValidated(true);
            updateCommitButtons();
            setStatusLine('Credentials validated. Select autocommit repositories and save.');
            await refreshAll({ force: true });
            updateIdentityPrompt();
            return;
        }
        if (validateOnly) {
            setStatusLine('Credentials already validated.');
            return;
        }

        let identitySaved = false;
        let tokenSaved = false;
        let repoPath = state.identityPrompt?.repoPath;
        if (identityValid && (identityRequired || identityValid)) {
            if (!repoPath) {
                repoPath = await resolveIdentityRepoPath();
            }
            if (!repoPath) {
                repoPath = state.reposRoot || state.repoPath || '';
            }
            if (!repoPath) {
                if (state.credentialsGate) {
                    setStatusLine('Select a repository to set identity.', true);
                    return;
                }
            } else {
                setRememberedGitIdentity({ name, email });
                identitySaved = true;
            }
        }

        if (tokenValid && (authRequired || tokenValid)) {
            if (remember) setRememberedGitPat(token);
            else setRememberedGitPat('');
            tokenSaved = true;
        }

        setAutocommitSettings({ intervalMinutes: autocommitIntervalMinutes, repos: autocommitRepos });
        setConflictAutoresolveSetting(autoresolveConflicts);
        try {
            window.dispatchEvent(new CustomEvent('webskel-autocommit-settings-changed'));
        } catch {
            // ignore dispatch errors
        }
        applyState({
            autocommitDirty: false,
            autocommitDraft: {
                intervalMinutes: autocommitIntervalMinutes,
                repos: autocommitRepos
            },
            autoresolveDirty: false,
            autoresolveDraft: { enabled: autoresolveConflicts },
            credentialsDirty: false
        }, { silent: true });

        const pending = state.authPrompt?.pendingAction || state.identityPrompt?.pendingAction;
        const wasGate = state.credentialsGate;

        applyState({
            identityPrompt: identitySaved
                ? { visible: false, repoPath: null, pendingAction: null, name: '', email: '' }
                : state.identityPrompt,
            authPrompt: (tokenSaved || authRequired)
                ? {
                    visible: false,
                    repoPath: null,
                    pendingAction: null,
                    token: remember ? '' : token,
                    remember: Boolean(remember)
                }
                : state.authPrompt,
            credentialsGate: identitySaved && state.credentialsGate ? false : state.credentialsGate,
            credentialsOpen: state.credentialsOpen && !state.credentialsGate ? false : state.credentialsOpen
        });
        updateCommitButtons();

        if (pending?.type) {
            if (pending.type === 'pull') {
                setStatusLine('Retrying pull…');
            } else if (pending.type === 'push') {
                setStatusLine('Retrying push…');
            } else if (pending.type === 'commit') {
                setStatusLine('Retrying commit…');
            }
            try {
                if (pending.type === 'commit') {
                    await commitSelectedRepos();
                } else if (pending.type === 'push') {
                    if (pending.mode === 'batch') {
                        const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                        await pushRepos(list, { token });
                    } else {
                        await push({ silent: false, token });
                    }
                } else if (pending.type === 'pull') {
                    if (pending.mode === 'batch') {
                        const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                        await pullRepos(list, { token });
                    } else {
                        await pullSelectedRepos();
                    }
                }
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
            return;
        }

        if (identitySaved && tokenSaved) {
            setStatusLine('Credentials saved.');
        } else if (identitySaved) {
            setStatusLine('Identity saved.');
        } else if (tokenSaved) {
            setStatusLine('Token saved.');
        }

        if (wasGate && identitySaved) {
            await refreshAll({ force: true });
        }
    };

    const ensureGitIdentityOrPrompt = async (repoPath, pendingAction) => {
        if (!repoPath) return false;
        const remembered = getRememberedGitIdentity();
        if (remembered.name && remembered.email) {
            return true;
        }
        const state = getState();
        const name = remembered.name || state.identityPrompt?.name || '';
        const email = remembered.email || state.identityPrompt?.email || '';
        applyState({
            identityPrompt: {
                visible: true,
                repoPath,
                pendingAction: pendingAction || null,
                name,
                email
            }
        });
        updateIdentityPrompt({ focus: !name ? 'name' : (!email ? 'email' : 'name') });
        updateCommitButtons();
        setStatusLine('Set name, email, and token to continue.', true);
        return false;
    };

    const saveGitIdentity = async (payload = {}) => {
        const state = getState();
        const repoPath = state.identityPrompt?.repoPath;
        if (!repoPath) return;
        const name = String(payload.name ?? state.identityPrompt?.name ?? '').trim();
        const email = String(payload.email ?? state.identityPrompt?.email ?? '').trim();
        applyState({
            identityPrompt: {
                ...state.identityPrompt,
                name,
                email
            }
        }, { silent: true });
        if (!name || !email) {
            applyState({
                identityPrompt: {
                    ...state.identityPrompt,
                    visible: true,
                    name,
                    email
                }
            });
            updateIdentityPrompt({ focus: !name ? 'name' : 'email' });
            updateCommitButtons();
            setStatusLine('Enter name and email.', true);
            return;
        }
        setRememberedGitIdentity({ name, email });
        const pending = state.identityPrompt?.pendingAction;
        const wasGate = state.credentialsGate;
        applyState({
            identityPrompt: { visible: false, repoPath: null, pendingAction: null, name: '', email: '' },
            credentialsGate: false
        });
        updateCommitButtons();
        setStatusLine('Identity saved locally. Git config unchanged.');

        if (wasGate && !pending?.type) {
            await refreshAll({ force: true });
        }
        if (pending?.type === 'commit') {
            if (pending.mode === 'batch') await commitSelectedRepos();
            else await commitSelectedRepos();
        } else if (pending?.type === 'push') {
            await push({ silent: false });
        } else if (pending?.type === 'pull') {
            await pullSelectedRepos();
        }
    };

    return {
        showGitAuthPrompt,
        openGitTokenPrompt,
        openGitIdentityPrompt,
        cancelGitToken,
        cancelGitIdentity,
        cancelGitCredentials,
        saveGitToken,
        saveGitCredentials,
        ensureGitIdentityOrPrompt,
        saveGitIdentity,
        resolveIdentityRepoPath
    };
}
