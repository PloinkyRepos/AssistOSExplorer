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
    getRememberedGitAuthMethod,
    getAutocommitSettings,
    normalizeGitAuthMethod,
    setRememberedGitPat,
    setRememberedGitIdentity,
    setRememberedGitAuthMethod,
    setAutocommitSettings,
    getConflictAutoresolveSetting,
    setConflictAutoresolveSetting,
    setCredentialsValidated
} from "./git-commit-modal-utils.js";
import { getRepoScanPaths } from "../../../utils/reposRoot.js";
import { AUTOCOMMIT_SETTINGS_CHANGED_EVENT } from "../../../utils/appEvents.js";

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
        syncSelectedRepos,
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
        const scanPaths = getRepoScanPaths({ rootHint: state.reposRoot });
        for (const scanPath of scanPaths) {
            if (!scanPath) continue;
            try {
                const payload = parseJsonToolResult(await service.gitReposOverview(scanPath)) || {};
                const repos = Array.isArray(payload.repos) ? payload.repos : [];
                const first = repos.map((repo) => repo?.path).find(Boolean);
                if (first) return first;
            } catch {
                // ignore
            }
        }
        return '';
    };

    const getGithubIdentityFallback = (state = getState()) => {
        const githubUser = state?.githubAuth?.connection?.user || {};
        return {
            name: String(githubUser?.name || githubUser?.login || '').trim(),
            email: String(githubUser?.email || '').trim()
        };
    };

    const getAuthMethod = (state = getState()) => {
        return normalizeGitAuthMethod(state.authPrompt?.authMethod || getRememberedGitAuthMethod());
    };

    const showGitAuthPrompt = (repoPath, pendingAction, { message = '', authMethod = null } = {}) => {
        const state = getState();
        const nextAuthMethod = normalizeGitAuthMethod(authMethod || getAuthMethod());
        setRememberedGitAuthMethod(nextAuthMethod);
        const remembered = getRememberedGitPat();
        applyState({
            pendingAction: pendingAction || null,
            authPrompt: {
                visible: true,
                repoPath,
                pendingAction: pendingAction || null,
                token: '',
                remember: Boolean(remembered),
                authMethod: nextAuthMethod
            }
        });
        updateAuthPrompt(nextAuthMethod === 'token' ? { focus: 'token' } : {});
        updateCommitButtons();
        let statusMessage = message;
        if (!statusMessage) {
            if (nextAuthMethod === 'github' && !state.githubAuth?.configured) {
                statusMessage = 'GitHub sign-in is not available in this workspace.';
            } else if (nextAuthMethod === 'github') {
                statusMessage = 'Authentication required. Connect GitHub to continue.';
            } else if (remembered) {
                statusMessage = 'A token is already saved. You can replace it, or switch to GitHub instead.';
            } else {
                statusMessage = 'Authentication required. Enter a token or switch to GitHub.';
            }
        }
        setStatusLine(statusMessage, true);
    };

    const openGitTokenPrompt = () => {
        const state = getState();
        showGitAuthPrompt(state.repoPath, null, { message: '', authMethod: 'token' });
    };

    const openGitIdentityPrompt = async () => {
        const state = getState();
        const repoPath = await resolveIdentityRepoPath();
        if (!repoPath) {
            setStatusLine('Select a repository to set identity.', true);
            return;
        }

        const remembered = getRememberedGitIdentity();
        const githubIdentity = getGithubIdentityFallback(state);
        const name = remembered.name || state.identityPrompt?.name || githubIdentity.name;
        const email = remembered.email || state.identityPrompt?.email || githubIdentity.email;
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
            authPrompt: {
                visible: false,
                repoPath: null,
                pendingAction: null,
                token: '',
                remember: false,
                authMethod: getAuthMethod(state)
            },
            credentialsOpen: state.credentialsOpen && !state.credentialsGate ? false : state.credentialsOpen,
            pendingAction: null
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
        const rememberedAuthMethod = getRememberedGitAuthMethod();
        const autocommit = getAutocommitSettings();
        const autoresolve = getConflictAutoresolveSetting();
        applyState({
            identityPrompt: {
                visible: false,
                repoPath: null,
                pendingAction: null,
                name: rememberedIdentity.name || '',
                email: rememberedIdentity.email || ''
            },
            authPrompt: {
                visible: false,
                repoPath: null,
                pendingAction: null,
                token: '',
                remember: Boolean(rememberedToken),
                authMethod: normalizeGitAuthMethod(rememberedAuthMethod)
            },
            credentialsOpen: false,
            credentialsGate: false,
            pendingAction: null,
            credentialsDirty: false,
            autocommitDirty: false,
            autocommitDraft: {
                intervalMinutes: Number(autocommit.intervalMinutes || 15),
                repos: Array.isArray(autocommit.repos) ? autocommit.repos : null
            },
            autoresolveDirty: false,
            autoresolveDraft: { enabled: Boolean(autoresolve) }
        });
        updateCommitButtons();
        updateIdentityPrompt();
        setStatusLine('');
        return true;
    };

    const saveGitToken = async (payload = {}) => {
        const state = getState();
        const pending = state.pendingAction || state.authPrompt?.pendingAction;
        const authMethod = 'token';
        const token = String(payload.token ?? state.authPrompt?.token ?? '').trim();
        const remember = typeof payload.remember === 'boolean' ? payload.remember : Boolean(state.authPrompt?.remember);
        setRememberedGitAuthMethod(authMethod);
        applyState({
            authPrompt: {
                ...state.authPrompt,
                token,
                remember,
                authMethod
            }
        }, { silent: true });
        if (!token) {
            applyState({
                authPrompt: {
                    ...state.authPrompt,
                    visible: true,
                    token: '',
                    remember,
                    authMethod
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
            authPrompt: {
                visible: false,
                repoPath: null,
                pendingAction: null,
                token: '',
                remember: false,
                authMethod
            }
        });
        updateCommitButtons();
        if (pending?.type === 'sync') {
            setStatusLine('Retrying sync…');
        } else {
            setStatusLine(pending?.type === 'pull' ? 'Retrying pull…' : 'Retrying push…');
        }
        try {
            if (pending?.type === 'sync') {
                const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : null;
                await syncSelectedRepos?.({ token, repoPaths: list });
            } else if (pending?.type === 'push') {
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
        const authMethod = normalizeGitAuthMethod(payload.authMethod ?? getAuthMethod(state));
        const token = String(payload.token ?? state.authPrompt?.token ?? '').trim();
        const remember = typeof payload.remember === 'boolean' ? payload.remember : Boolean(state.authPrompt?.remember);
        const validateOnly = Boolean(payload.validateOnly);
        const autocommitIntervalMinutes = payload.autocommitIntervalMinutes;
        const autocommitRepos = Array.isArray(payload.autocommitRepos) ? payload.autocommitRepos : null;
        const autoresolveConflicts = typeof payload.autoresolveConflicts === 'boolean'
            ? payload.autoresolveConflicts
            : getConflictAutoresolveSetting();
        const githubConnected = Boolean(state.githubAuth?.connected);
        const githubConfigured = Boolean(state.githubAuth?.configured);
        const rememberedToken = getRememberedGitPat();
        const rememberedIdentity = getRememberedGitIdentity();
        const rememberedAuthMethod = normalizeGitAuthMethod(getRememberedGitAuthMethod());
        const usingGithub = authMethod === 'github';
        const hasIdentityChange = name !== String(rememberedIdentity.name || '').trim()
            || email !== String(rememberedIdentity.email || '').trim();
        const hasAuthMethodChange = authMethod !== rememberedAuthMethod;
        const hasTokenChange = usingGithub
            ? Boolean(rememberedToken)
            : (remember ? token !== String(rememberedToken || '') : Boolean(rememberedToken));
        const hasPersistableChanges = hasIdentityChange || hasAuthMethodChange || hasTokenChange;

        if (
            !state.credentialsDirty
            && !state.autocommitDirty
            && !state.autoresolveDirty
            && !state.credentialsGate
            && !state.pendingAction
            && !hasPersistableChanges
        ) {
            setStatusLine('');
            return true;
        }

        const identityRequired = Boolean(state.credentialsGate || state.identityPrompt?.visible);
        const authRequired = Boolean(state.authPrompt?.visible);
        const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        const identityValid = Boolean(name && email && emailPattern.test(email));
        const effectiveToken = usingGithub ? '' : (token || (remember ? rememberedToken : ''));
        const authValid = usingGithub ? githubConnected : Boolean(effectiveToken);
        setRememberedGitAuthMethod(authMethod);

        applyState({
            identityPrompt: {
                ...state.identityPrompt,
                name,
                email
            },
            authPrompt: {
                ...state.authPrompt,
                token,
                remember,
                authMethod
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
            return false;
        }
        if (!usingGithub && !remember) {
            setRememberedGitPat('');
        }
        const pending = state.pendingAction || state.authPrompt?.pendingAction || state.identityPrompt?.pendingAction;
        const canSaveGithubSetup = usingGithub && githubConfigured && !githubConnected && !pending?.type && !validateOnly;

        if (!authValid && !canSaveGithubSetup) {
            applyState({
                authPrompt: {
                    ...state.authPrompt,
                    visible: true,
                    token: '',
                    remember,
                    authMethod
                }
            });
            updateAuthPrompt(authMethod === 'token' ? { focus: 'token' } : {});
            updateCommitButtons();
            setStatusLine(
                authMethod === 'github'
                    ? (state.githubAuth?.configured ? 'Connect GitHub to continue.' : 'GitHub sign-in is not available in this workspace.')
                    : 'Enter a token to continue.',
                true
            );
            return false;
        }

        if (!state.credentialsValidated && !state.credentialsDirty && (state.autocommitDirty || state.autoresolveDirty) && !validateOnly) {
            setAutocommitSettings({ intervalMinutes: autocommitIntervalMinutes, repos: autocommitRepos });
            setConflictAutoresolveSetting(autoresolveConflicts);
            try {
                window.dispatchEvent(new CustomEvent(AUTOCOMMIT_SETTINGS_CHANGED_EVENT));
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
            return true;
        }

        if (!state.credentialsValidated && pending?.type && identityValid && authValid && !validateOnly) {
            applyState({ credentialsValidated: true });
            setCredentialsValidated(true);
        } else if (!state.credentialsValidated && !authValid && !validateOnly) {
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
                return false;
            }
            if (!authValid) {
                setStatusLine(
                    authMethod === 'github'
                        ? (state.githubAuth?.configured ? 'Connect GitHub to validate credentials.' : 'GitHub sign-in is not available in this workspace.')
                        : 'Enter a token to validate credentials.',
                    true
                );
                return false;
            }
            setStatusLine('Validating credentials...');
            try {
                await service.gitPull({
                    path: validationRepoPath,
                    rebase: false,
                    ffOnly: false,
                    token: usingGithub ? null : effectiveToken
                });
            } catch (error) {
                const msg = normalizeErrorMessage(error);
                const lower = msg.toLowerCase();
                if (isGitAuthError(msg) || lower.includes('repository not found')) {
                    setStatusLine(
                        usingGithub
                            ? 'GitHub validation failed. Reconnect GitHub or use a token.'
                            : 'Token validation failed. Check your token and repo access.',
                        true
                    );
                    return false;
                }
                if (lower.includes('remote is not https')) {
                    setStatusLine(msg, true);
                    return false;
                }
                if (isGitIdentityError(msg)) {
                    setStatusLine('Author identity is not valid for git. Update name/email and retry.', true);
                    return false;
                }
                if (!isGitPullBlockedError(msg) && !isGitConflictError(msg)) {
                    setStatusLine(msg || 'Unable to validate credentials.', true);
                    return false;
                }
            }
            applyState({ credentialsValidated: true });
            setCredentialsValidated(true);
            updateCommitButtons();
            setStatusLine('Credentials validated. Select autocommit repositories and save.');
            await refreshAll({ force: true });
            updateIdentityPrompt();
            return false;
        }
        if (validateOnly) {
            setStatusLine('Credentials already validated.');
            return false;
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
                    return false;
                }
            } else {
                setRememberedGitIdentity({ name, email });
                identitySaved = true;
            }
        }

        if (!usingGithub && authValid && (authRequired || authValid)) {
            if (remember) setRememberedGitPat(effectiveToken);
            else setRememberedGitPat('');
            tokenSaved = true;
        }

        setAutocommitSettings({ intervalMinutes: autocommitIntervalMinutes, repos: autocommitRepos });
        setConflictAutoresolveSetting(autoresolveConflicts);
        try {
            window.dispatchEvent(new CustomEvent(AUTOCOMMIT_SETTINGS_CHANGED_EVENT));
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
                    remember: Boolean(remember),
                    authMethod
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
            } else if (pending.type === 'sync') {
                setStatusLine('Retrying sync…');
            } else if (pending.type === 'commit') {
                setStatusLine('Retrying commit…');
            }
            try {
                if (pending.type === 'commit') {
                    await commitSelectedRepos();
                } else if (pending.type === 'sync') {
                    const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : null;
                    await syncSelectedRepos?.({ token: usingGithub ? null : effectiveToken, repoPaths: list });
                } else if (pending.type === 'push') {
                    if (pending.mode === 'batch') {
                        const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                        await pushRepos(list, { token: usingGithub ? null : effectiveToken });
                    } else {
                        await push({ silent: false, token: usingGithub ? null : effectiveToken });
                    }
                } else if (pending.type === 'pull') {
                    if (pending.mode === 'batch') {
                        const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                        await pullRepos(list, { token: usingGithub ? null : effectiveToken });
                    } else {
                        await pullSelectedRepos();
                    }
                }
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
            return true;
        }

        if (identitySaved && tokenSaved) {
            setStatusLine('Credentials saved.');
        } else if (identitySaved && usingGithub) {
            setStatusLine(githubConnected ? 'Identity saved. GitHub is ready.' : 'Identity saved. Finish GitHub sign-in when you need Git operations.');
        } else if (identitySaved) {
            setStatusLine('Identity saved.');
        } else if (tokenSaved) {
            setStatusLine('Token saved.');
        } else if (usingGithub && githubConnected) {
            setStatusLine('GitHub authentication ready.');
        } else if (usingGithub && githubConfigured) {
            setStatusLine('Saved. Finish GitHub sign-in when you need Git operations.');
        }

        if (wasGate && identitySaved) {
            await refreshAll({ force: true });
        }
        return true;
    };

    const ensureGitIdentityOrPrompt = async (repoPath, pendingAction) => {
        if (!repoPath) return false;
        const remembered = getRememberedGitIdentity();
        if (remembered.name && remembered.email) {
            return true;
        }
        const state = getState();
        const stateGithubIdentity = getGithubIdentityFallback(state);
        const name = remembered.name || state.identityPrompt?.name || stateGithubIdentity.name;
        const email = remembered.email || state.identityPrompt?.email || stateGithubIdentity.email;
        applyState({
            identityPrompt: {
                visible: true,
                repoPath,
                pendingAction: pendingAction || null,
                name,
                email
            },
            pendingAction: pendingAction || null
        });
        updateIdentityPrompt({ focus: !name ? 'name' : (!email ? 'email' : 'name') });
        updateCommitButtons();
        const githubConnected = Boolean(state.githubAuth?.connected);
        setStatusLine(
            githubConnected
                ? 'Set name/email to continue.'
                : 'Set name/email and connect GitHub or add a token to continue.',
            true
        );
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
        const pending = state.pendingAction || state.identityPrompt?.pendingAction;
        const wasGate = state.credentialsGate;
        applyState({
            identityPrompt: { visible: false, repoPath: null, pendingAction: null, name: '', email: '' },
            credentialsGate: false,
            pendingAction: null
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
        } else if (pending?.type === 'sync') {
            await syncSelectedRepos?.();
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
