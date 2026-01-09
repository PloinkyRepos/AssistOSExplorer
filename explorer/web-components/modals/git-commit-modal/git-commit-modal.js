import { parseDetailedDirectoryListing, joinPath } from "../../pages/file-exp/file-exp-utils.js";
import {
    normalizeErrorMessage,
    humanizeGitError,
    parseJsonToolResult,
    isReposRootPath,
    isGitAuthError,
    isGitIdentityError,
    getRememberedGitPat,
    setRememberedGitPat
} from "./git-commit-modal-utils.js";
import {
    ensureSelectionEntry,
    peekSelectionEntry,
    isPathSelected,
    getCoveringPrefix as getCoveringPrefixFromEntry,
    getAncestorCoveringPrefix as getAncestorCoveringPrefixFromEntry,
    toggleFileSelection as toggleFileSelectionOnEntry,
    togglePrefixSelection as togglePrefixSelectionOnEntry
} from "./git-commit-modal-selection.js";
import { formatRepoSummary, renderRepoChangesTree } from "./git-commit-modal-tree.js";
import { callToolWithLoader, withGlobalLoader } from "../../../utils/globalLoader.js";

export class GitCommitModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.statusCache = { at: 0, payload: null };
        this.diffCache = new Map();
        this.repoOverviewCache = { at: 0, list: [] };
        this.dialogState = { isFullscreen: false, prev: null };
        this.state = {
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
            pullMenuOpen: false,
            settingsMenuOpen: false,
            amend: false,
            signoff: false,
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
            lastStatusLine: ''
        };
        this.invalidate();
    }

    beforeRender() {}

    peekSelectedFilesEntry(repoPath) {
        return peekSelectionEntry(this.state.selectedFilesByRepo, repoPath);
    }

    afterRender() {
        this.bindEvents();
        this.syncStaticUI();
        this.ensureDialogResizable();
        // On open: force-load repos overview so the user immediately sees changes across all repos.
        this.refreshAll({ force: true });
    }

    getDialogElement() {
        return this.element?.closest?.('dialog') || null;
    }

    ensureDialogPositioning() {
        const dialog = this.getDialogElement();
        if (!dialog) return null;
        if (dialog.dataset.gitPositioned === 'true') return dialog;
        const rect = dialog.getBoundingClientRect();
        dialog.style.left = `${rect.left}px`;
        dialog.style.top = `${rect.top}px`;
        dialog.style.width = `${rect.width}px`;
        dialog.style.height = `${rect.height}px`;
        dialog.classList.add('git-positioned');
        dialog.dataset.gitPositioned = 'true';
        return dialog;
    }

    ensureDialogResizable() {
        const dialog = this.getDialogElement();
        if (!dialog) return;
        if (dialog.dataset.gitResizable === 'true') return;

        const host = this.element.querySelector('.git-modal') || this.element;
        const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
        for (const dir of handles) {
            const h = document.createElement('div');
            h.className = `git-resize-handle ${dir}`;
            h.dataset.dir = dir;
            h.addEventListener('pointerdown', (event) => this.startResize(event, dir));
            host.appendChild(h);
        }
        dialog.dataset.gitResizable = 'true';
    }

    startResize(event, dir) {
        const dialog = this.ensureDialogPositioning();
        if (!dialog) return;
        if (dialog.classList.contains('is-fullscreen')) return;

        event.preventDefault();
        event.stopPropagation();

        const startRect = dialog.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const minW = 760;
        const minH = 520;

        const onMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let left = startRect.left;
            let top = startRect.top;
            let width = startRect.width;
            let height = startRect.height;

            if (dir.includes('e')) width = startRect.width + dx;
            if (dir.includes('s')) height = startRect.height + dy;
            if (dir.includes('w')) {
                width = startRect.width - dx;
                left = startRect.left + dx;
            }
            if (dir.includes('n')) {
                height = startRect.height - dy;
                top = startRect.top + dy;
            }

            width = Math.max(minW, width);
            height = Math.max(minH, height);

            // Clamp left/top so resizing from west/north doesn't "drift" after hitting min sizes.
            if (dir.includes('w') && width === minW) {
                left = startRect.right - minW;
            }
            if (dir.includes('n') && height === minH) {
                top = startRect.bottom - minH;
            }

            dialog.style.left = `${left}px`;
            dialog.style.top = `${top}px`;
            dialog.style.width = `${width}px`;
            dialog.style.height = `${height}px`;
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
        };

        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
    }

    toggleFullscreen() {
        const dialog = this.ensureDialogPositioning();
        if (!dialog) return;

        const isNowFullscreen = !dialog.classList.contains('is-fullscreen');
        if (isNowFullscreen) {
            const rect = dialog.getBoundingClientRect();
            this.dialogState.prev = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            dialog.classList.add('is-fullscreen');
            this.dialogState.isFullscreen = true;
            return;
        }

        dialog.classList.remove('is-fullscreen');
        const prev = this.dialogState.prev;
        if (prev) {
            dialog.style.left = `${prev.left}px`;
            dialog.style.top = `${prev.top}px`;
            dialog.style.width = `${prev.width}px`;
            dialog.style.height = `${prev.height}px`;
        }
        this.dialogState.isFullscreen = false;
    }

    bindEvents() {
        if (!this.element.dataset.boundDiffKeys) {
            this.element.addEventListener('keydown', (event) => {
                const key = event.key;
                if (key !== 'Enter' && key !== ' ') return;
                const target = event.target?.closest?.(
                    '.git-tree-file[data-local-action="openDiff"], ' +
                    '.git-menu-item[data-local-action^="runGitAction"]'
                );
                if (!target) return;
                event.preventDefault();
                const action = target.getAttribute('data-local-action') || '';
                if (action.startsWith('runGitAction')) {
                    const mode = action.split(/\s+/)[1] || '';
                    this.runGitAction(target, mode);
                    return;
                }
                this.openDiff(target);
            });
            this.element.dataset.boundDiffKeys = 'true';
        }

        const repoPathInput = this.element.querySelector('#gitRepoPathInput');
        if (repoPathInput && !repoPathInput.dataset.bound) {
            repoPathInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.applyRepoPathFromInput();
                }
            });
            repoPathInput.dataset.bound = 'true';
        }

        const commitMessage = this.element.querySelector('#gitCommitMessage');
        if (commitMessage && !commitMessage.dataset.bound) {
            commitMessage.addEventListener('input', (event) => {
                this.updateCommitMessage(event.target);
            });
            commitMessage.dataset.bound = 'true';
        }

        const amendInput = this.element.querySelector('#gitCommitAmend');
        if (amendInput && !amendInput.dataset.bound) {
            // WebSkel handles via `data-local-action="toggleAmend"`.
            amendInput.dataset.bound = 'true';
        }

        const signoffInput = this.element.querySelector('#gitCommitSignoff');
        if (signoffInput && !signoffInput.dataset.bound) {
            // WebSkel handles via `data-local-action="toggleSignoff"`.
            signoffInput.dataset.bound = 'true';
        }

        if (!this.element.dataset.boundCommitMenu) {
            const closeIfOutside = (event) => {
                const closeMenuIfOutside = (isOpen, rootSelector, closeFn) => {
                    if (!isOpen) return;
                    const root = this.element.querySelector(rootSelector);
                    const inside = root && (event.target === root || root.contains(event.target));
                    if (!inside) closeFn();
                };
                closeMenuIfOutside(this.state.actionsMenuOpen, '#gitActionsSplit', () => this.closeActionsMenu());
                closeMenuIfOutside(this.state.pullMenuOpen, '#gitPullSplit', () => this.closePullMenu());
                closeMenuIfOutside(this.state.settingsMenuOpen, '#gitSettingsSplit', () => this.closeSettingsMenu());
            };
            document.addEventListener('pointerdown', closeIfOutside, true);
            this.element.dataset.boundCommitMenu = 'true';
        }

        if (!this.element.dataset.boundPromptEvents) {
            this.element.addEventListener('git-auth-submit', (event) => {
                this.saveGitToken(event?.detail || {});
            });
            this.element.addEventListener('git-auth-cancel', () => {
                this.cancelGitToken();
            });
            this.element.addEventListener('git-auth-change', (event) => {
                const detail = event?.detail || {};
                this.state.authPrompt = {
                    ...this.state.authPrompt,
                    token: String(detail.token ?? this.state.authPrompt?.token ?? ''),
                    remember: typeof detail.remember === 'boolean' ? detail.remember : Boolean(this.state.authPrompt?.remember)
                };
            });
            this.element.addEventListener('git-identity-submit', (event) => {
                this.saveGitIdentity(event?.detail || {});
            });
            this.element.addEventListener('git-identity-cancel', () => {
                this.cancelGitIdentity();
            });
            this.element.addEventListener('git-identity-change', (event) => {
                const detail = event?.detail || {};
                this.state.identityPrompt = {
                    ...this.state.identityPrompt,
                    name: String(detail.name ?? this.state.identityPrompt?.name ?? ''),
                    email: String(detail.email ?? this.state.identityPrompt?.email ?? '')
                };
            });
            this.element.dataset.boundPromptEvents = 'true';
        }

        const changesRoot = this.element.querySelector('.git-changes');
        if (changesRoot && !changesRoot.dataset.bound) {
            // Selection is handled via WebSkel `data-local-action` on checkboxes.
            changesRoot.dataset.bound = 'true';
        }

        if (!this.element.dataset.boundEscape) {
            this.element.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    event.preventDefault();
                    this.closeModal();
                }
            });
            this.element.dataset.boundEscape = 'true';
        }
    }

    closeModalAction() {
        this.closeModal();
    }

    refreshAction() {
        this.refreshAll({ force: true });
    }

    updateCommitMessage(element) {
        this.state.commitMessage = element?.value || '';
        this.updateCommitButtons();
    }

    toggleAmend(element) {
        this.state.amend = Boolean(element?.checked);
        this.updateCommitButtons();
    }

    toggleSignoff(element) {
        this.state.signoff = Boolean(element?.checked);
    }

    pushAction() {
        this.push({ silent: false });
    }

    pullAction() {
        this.pullSelectedRepos();
    }

    toggleTreePrefixSelectionCheckbox(element) {
        const repoPath = element?.dataset?.repoPath;
        const prefix = element?.dataset?.prefix || '';
        if (!repoPath) return;
        this.togglePrefixSelection(repoPath, prefix, Boolean(element.checked));
    }

    toggleTreeFileSelectionCheckbox(element) {
        const repoPath = element?.dataset?.repoPath;
        const filePath = element?.dataset?.filePath;
        if (!repoPath || !filePath) return;
        this.toggleFileSelection(repoPath, filePath, null, Boolean(element.checked));
    }

    toggleRepoAllChangesCheckbox(element) {
        const repoPath = element?.dataset?.repoPath;
        if (!repoPath) return;
        const entry = this.getSelectedFilesEntry(repoPath);
        if (!entry) return;
        togglePrefixSelectionOnEntry(entry, '*', Boolean(element.checked));
        this.updateCommitButtons();
        this.renderRepoOverviews(this.state.repoOverviews);
    }

    openDiff(element) {
        const repoPath = element?.dataset?.repoPath || null;
        const filePath = element?.dataset?.filePath;
        const section = element?.dataset?.section || null;
        if (!filePath) return;
        this.selectFile(filePath, section, repoPath);
    }

    toggleRepoFolderExpanded(element) {
        const folderId = element?.dataset?.folderId;
        if (!folderId) return;
        this.toggleFolderExpanded(folderId);
    }

    syncStaticUI() {
        const subtitle = this.element.querySelector('#gitRepoSubtitle');
        if (subtitle) {
            subtitle.textContent = `Repository: ${this.state.repoPath}`;
        }
        const repoPathInput = this.element.querySelector('#gitRepoPathInput');
        if (repoPathInput && repoPathInput.value !== this.state.repoPath) {
            repoPathInput.value = this.state.repoPath;
        }

        this.updateIdentityPrompt();

        const actionsMenu = this.element.querySelector('#gitActionsMenu');
        if (actionsMenu) {
            actionsMenu.style.display = this.state.actionsMenuOpen ? '' : 'none';
        }

        const pullMenu = this.element.querySelector('#gitPullMenu');
        if (pullMenu) {
            pullMenu.style.display = this.state.pullMenuOpen ? '' : 'none';
            const items = pullMenu.querySelectorAll('.git-menu-item');
            items.forEach((el) => {
                const action = el.getAttribute('data-local-action') || '';
                const parts = action.split(/\s+/);
                const mode = parts[0] === 'setPullMode' ? parts[1] : null;
                el.classList.toggle('active', Boolean(mode && mode === this.state.pullMode));
            });
        }

        const settingsMenu = this.element.querySelector('#gitSettingsMenu');
        if (settingsMenu) {
            settingsMenu.style.display = this.state.settingsMenuOpen ? '' : 'none';
        }

        this.updateAuthPrompt();
    }

    getIdentityPromptPresenter() {
        return this.element.querySelector('git-identity-prompt')?.webSkelPresenter || null;
    }

    getAuthPromptPresenter() {
        return this.element.querySelector('git-auth-prompt')?.webSkelPresenter || null;
    }

    updateIdentityPrompt(options = {}) {
        const state = this.state.identityPrompt || {};
        const detail = {
            visible: Boolean(state.visible),
            name: state.name || '',
            email: state.email || ''
        };
        if (options.focus) detail.focus = options.focus;
        const presenter = this.getIdentityPromptPresenter();
        if (presenter?.setState) {
            presenter.setState(detail);
            return;
        }
        const element = this.element.querySelector('git-identity-prompt');
        element?.dispatchEvent?.(new CustomEvent('git-identity-update', { detail }));
    }

    updateAuthPrompt(options = {}) {
        const state = this.state.authPrompt || {};
        const detail = {
            visible: Boolean(state.visible),
            token: state.token || '',
            remember: Boolean(state.remember)
        };
        if (options.focus) detail.focus = options.focus;
        const presenter = this.getAuthPromptPresenter();
        if (presenter?.setState) {
            presenter.setState(detail);
            return;
        }
        const element = this.element.querySelector('git-auth-prompt');
        element?.dispatchEvent?.(new CustomEvent('git-auth-update', { detail }));
    }

    async applyRepoPathFromInput() {
        const input = this.element.querySelector('#gitRepoPathInput');
        const next = (input?.value || '').trim();
        if (!next) {
            this.setStatusLine('Enter a repository path.', true);
            return;
        }
        this.state.repoPath = next;
        this.state.selectedRepoPath = null;
        this.statusCache = { at: 0, payload: null };
        this.diffCache.clear();
        this.state.selectedPath = null;
        this.state.selectedSection = null;
        this.state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
        this.state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        this.closeActionsMenu();
        this.syncStaticUI();
        await this.refreshAll({ force: true });
    }

    toggleActionsMenu() {
        this.state.actionsMenuOpen = !this.state.actionsMenuOpen;
        if (this.state.actionsMenuOpen) {
            this.closeSettingsMenu();
        }
        this.syncStaticUI();
        if (this.state.actionsMenuOpen) {
            setTimeout(() => this.element.querySelector('#gitActionsMenu .git-menu-item')?.focus?.(), 0);
        }
    }

    closeActionsMenu() {
        if (!this.state.actionsMenuOpen) return;
        this.state.actionsMenuOpen = false;
        this.syncStaticUI();
    }

    togglePullMenu() {
        this.state.pullMenuOpen = !this.state.pullMenuOpen;
        if (this.state.pullMenuOpen) {
            this.closeSettingsMenu();
            this.closeActionsMenu();
        }
        this.syncStaticUI();
        if (this.state.pullMenuOpen) {
            setTimeout(() => this.element.querySelector('#gitPullMenu .git-menu-item.active')?.focus?.(), 0);
        }
    }

    closePullMenu() {
        if (!this.state.pullMenuOpen) return;
        this.state.pullMenuOpen = false;
        this.syncStaticUI();
    }

    toggleSettingsMenu() {
        this.state.settingsMenuOpen = !this.state.settingsMenuOpen;
        if (this.state.settingsMenuOpen) {
            this.closeActionsMenu();
            this.closePullMenu();
        }
        this.syncStaticUI();
        if (this.state.settingsMenuOpen) {
            setTimeout(() => this.element.querySelector('#gitSettingsMenu .git-menu-item')?.focus?.(), 0);
        }
    }

    closeSettingsMenu() {
        if (!this.state.settingsMenuOpen) return;
        this.state.settingsMenuOpen = false;
        this.syncStaticUI();
    }

    setCommitMode(element, mode) {
        const next = (mode || element?.dataset?.mode || '').trim();
        if (next !== 'commit' && next !== 'commitPush') return;
        this.state.commitMode = next;
        this.closeActionsMenu();
        this.updateCommitButtons();
        if (this.state.identityPrompt?.visible) return;
        if (this.state.authPrompt?.visible) return;
        this.commit();
    }

    runGitAction(element, mode) {
        const next = (mode || element?.dataset?.mode || '').trim();
        if (!next) return;
        if (next === 'commit' || next === 'commitPush') {
            const messageOk = Boolean((this.state.commitMessage || '').trim()) || this.state.amend;
            const selected = this.getSelectedReposForBatch();
            if (!selected.length) {
                this.setStatusLine('Select at least one file to commit.', true);
                return;
            }
            if (!messageOk) {
                this.setStatusLine('Enter a commit message.', true);
                return;
            }
            this.setCommitMode(null, next);
            return;
        }
        if (next === 'push') {
            this.closeActionsMenu();
            if (!this.state.repoPath || isReposRootPath(this.state.repoPath, this.state.reposRoot) || this.state.repoInfoOk === false) {
                this.setStatusLine('Select a repository to push.', true);
                return;
            }
            if (this.state.identityPrompt?.visible || this.state.authPrompt?.visible) return;
            this.push({ silent: false });
        }
    }

    setPullMode(element, mode) {
        const next = (mode || element?.dataset?.mode || '').trim();
        if (next !== 'ffOnly' && next !== 'rebase' && next !== 'merge') return;
        this.state.pullMode = next;
        this.closePullMenu();
        this.syncStaticUI();
        if (this.state.identityPrompt?.visible) return;
        if (this.state.authPrompt?.visible) return;
        this.pullSelectedRepos();
    }

    setStatusLine(text, isError = false) {
        this.state.lastStatusLine = text || '';
        const status = this.element.querySelector('#gitStatusLine');
        if (!status) return;
        status.textContent = this.state.lastStatusLine;
        status.classList.toggle('error', Boolean(isError));
    }

    async callTool(name, args) {
        const result = await callToolWithLoader('explorer', name, args);
        if (result?.text?.startsWith?.('Error:')) {
            throw new Error(result.text);
        }
        return result?.text ?? '';
    }

    async callAgentTool(agentName, name, args) {
        const client = window.webSkel?.appServices?.getClient?.(agentName);
        if (!client || typeof client.callTool !== 'function') {
            throw new Error(`Agent client not available: ${agentName}`);
        }
        const result = await client.callTool(name, args || {});
        const blocks = Array.isArray(result?.content) ? result.content : [];
        const firstText = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
        let text = firstText ? firstText.text : JSON.stringify(result, null, 2);

        if (typeof text === 'string') {
            const trimmed = text.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed?.content)) {
                        const inner = parsed.content.find((block) => block?.type === 'text' && typeof block.text === 'string');
                        if (inner?.text) text = inner.text;
                    } else if (typeof parsed?.text === 'string') {
                        text = parsed.text;
                    }
                } catch {
                    // keep original text
                }
            }
        }

        if (text?.startsWith?.('Error:')) throw new Error(text);
        return text || '';
    }

    async generateCommitMessage() {
        const messageBox = this.element.querySelector('#gitCommitMessage');
        const selectedRepos = this.getSelectedReposForBatch();
        if (!selectedRepos.length) {
            this.setStatusLine('Select at least one file to generate a message.', true);
            return;
        }

        this.setStatusLine('Generating commit message…');
        return withGlobalLoader(async () => {
            try {
                const selections = selectedRepos.map((repoPath) => ({
                    repoPath,
                    files: this.getPathsForCommitInRepo(repoPath)
                })).filter((s) => s.repoPath && Array.isArray(s.files) && s.files.length > 0);
                if (!selections.length) {
                    this.setStatusLine('Select at least one file to generate a message.', true);
                    return;
                }

                const diffs = [];
                const maxFilesPerRepo = 80;
                const maxFilesTotal = 20;

                for (const selection of selections) {
                    const repoPath = selection.repoPath;
                    const files = Array.isArray(selection.files) ? selection.files.slice(0, maxFilesPerRepo) : [];
                    for (const filePath of files) {
                        if (diffs.length >= maxFilesTotal) break;
                        const diff = await this.callTool('git_diff', {
                            path: repoPath,
                            file: filePath,
                            cached: false,
                            ref: 'HEAD'
                        });
                        diffs.push({ repoPath, filePath, diff: diff || '' });
                    }
                    if (diffs.length >= maxFilesTotal) break;
                }

                if (!diffs.length) {
                    this.setStatusLine('Select at least one file to generate a message.', true);
                    return;
                }

                const payloadText = await this.callAgentTool('explorerSkillsAgent', 'git_commit_message', { diffs });
                const payload = parseJsonToolResult(payloadText) || {};
                if (payload.ok === false) {
                    throw new Error(payload.error || 'Failed to generate commit message.');
                }
                const next = String(payload.message || '').trim();
                if (!next) throw new Error('AI returned an empty commit message.');

                this.state.commitMessage = String(next);
                if (messageBox) {
                    messageBox.value = String(next);
                    messageBox.focus();
                }
                this.updateCommitButtons();
                this.setStatusLine('Commit message generated.');
            } catch (error) {
                this.setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    }

    async refreshAll({ force = false } = {}) {
        this.setStatusLine('Loading git status…');
        try {
            await this.loadRepoOverviews({ force });
            this.reconcileSelectedDiffWithChanges();

            // Multi-repo view: don't call git_info/git_status on the repos root.
            if (isReposRootPath(this.state.repoPath, this.state.reposRoot)) {
                this.state.repoInfoOk = false;
                this.state.branch = null;
                this.state.upstream = null;
                this.state.remotes = [];
                this.state.selectedRepoPath = null;
                this.updateCommitButtons();
                const branchInfo = this.element.querySelector('#gitBranchInfo');
                if (branchInfo) {
                    branchInfo.textContent = 'Multi-repo view. Select a repository to see branch/status.';
                }
                this.setStatusLine('Select a repository from the list.');
                return;
            }

            const repoInfo = await this.loadRepoInfo({ force });
            if (repoInfo && repoInfo.ok === false) {
                this.updateCommitButtons();
                this.setStatusLine('Select a repository from the list.');
                return;
            }
            this.reconcileSelectedDiffWithChanges();
            this.updateCommitButtons();
            if (!this.state.selectedPath) {
                this.setStatusLine('Ready.');
            } else {
                this.setStatusLine('Ready.');
            }
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        }
    }

    async loadRepoInfo({ force = false } = {}) {
        const cached = this.statusCache.payload?.repoInfo;
        if (!force && cached) {
            this.applyRepoInfo(cached);
            return cached;
        }
        const text = await this.callTool('git_info', { path: this.state.repoPath });
        const payload = parseJsonToolResult(text) || {};
        this.statusCache = {
            at: this.statusCache.at || 0,
            payload: {
                ...(this.statusCache.payload || {}),
                repoInfo: payload
            }
        };
        this.applyRepoInfo(payload);
        return payload;
    }

    applyRepoInfo(info) {
        this.state.branch = info.branch || null;
        this.state.upstream = info.upstream || null;
        this.state.remotes = Array.isArray(info.remotes) ? info.remotes : [];
        this.state.repoInfoOk = info && typeof info.ok === 'boolean' ? info.ok : null;
        const branchInfo = this.element.querySelector('#gitBranchInfo');
        if (branchInfo) {
            if (info && info.ok === false) {
                branchInfo.textContent = 'Not a git repository. Choose a repo path that contains a .git folder.';
                return;
            }
            const bits = [];
            if (this.state.branch) bits.push(`Branch: ${this.state.branch}`);
            if (this.state.upstream) bits.push(`Upstream: ${this.state.upstream}`);
            branchInfo.textContent = bits.length ? bits.join(' · ') : 'Not a git repository.';
        }
    }

    getSelectedFilesEntry(repoPath) {
        if (!repoPath) return null;
        const store = this.state.selectedFilesByRepo || {};
        const entry = ensureSelectionEntry(store, repoPath);
        this.state.selectedFilesByRepo = store;
        return entry;
    }

    isFileSelected(repoPath, filePath) {
        const entry = this.peekSelectedFilesEntry(repoPath);
        return isPathSelected(entry, filePath);
    }

    toggleFileSelection(repoPath, filePath, section, isSelected) {
        if (!repoPath || !filePath) return;
        const entry = this.getSelectedFilesEntry(repoPath);
        if (!entry) return;
        toggleFileSelectionOnEntry(entry, filePath, section, isSelected);
        this.updateCommitButtons();
        this.renderRepoOverviews(this.state.repoOverviews);
    }

    getCoveringPrefix(repoPath, relativePath) {
        const entry = this.peekSelectedFilesEntry(repoPath);
        return getCoveringPrefixFromEntry(entry, relativePath);
    }

    getAncestorCoveringPrefix(repoPath, prefix) {
        const entry = this.peekSelectedFilesEntry(repoPath);
        return getAncestorCoveringPrefixFromEntry(entry, prefix);
    }

    togglePrefixSelection(repoPath, prefix, isSelected) {
        if (!repoPath) return;
        const entry = this.getSelectedFilesEntry(repoPath);
        if (!entry) return;
        togglePrefixSelectionOnEntry(entry, prefix, isSelected);
        this.updateCommitButtons();
        this.renderRepoOverviews(this.state.repoOverviews);
    }

    toggleFolderExpanded(folderId) {
        if (!folderId) return;
        const expanded = { ...(this.state.repoTreeExpanded || {}) };
        expanded[folderId] = expanded[folderId] === true ? false : true;
        this.state.repoTreeExpanded = expanded;
        this.renderRepoOverviews(this.state.repoOverviews);
    }

    toggleRepoChanges(element) {
        const repoPath = element?.dataset?.repoPath;
        if (!repoPath) return;
        const expanded = { ...(this.state.repoChangesExpanded || {}) };
        const current = expanded[repoPath];
        expanded[repoPath] = current === undefined ? false : !current;
        this.state.repoChangesExpanded = expanded;
        this.renderRepoOverviews(this.state.repoOverviews);
    }

    isRepoChangesExpanded(repoPath) {
        if (!repoPath) return true;
        const current = this.state.repoChangesExpanded?.[repoPath];
        return current === undefined ? true : Boolean(current);
    }

    toggleTreeFolder(element) {
        const repoPath = element?.dataset?.repoPath;
        const prefix = element?.dataset?.prefix;
        if (!repoPath || !prefix) return;
        const key = `${repoPath}::${prefix}`;
        const expanded = { ...(this.state.treeExpandedByRepo || {}) };
        const current = expanded[key];
        expanded[key] = current === undefined ? false : !current;
        this.state.treeExpandedByRepo = expanded;
        this.renderRepoOverviews(this.state.repoOverviews);
    }

    isTreeFolderExpanded(repoPath, prefix) {
        if (!repoPath || !prefix) return true;
        const key = `${repoPath}::${prefix}`;
        const current = this.state.treeExpandedByRepo?.[key];
        return current === undefined ? true : Boolean(current);
    }

    getDisplayedRepoOverviews() {
        const repos = Array.isArray(this.state.repoOverviews) ? this.state.repoOverviews : [];
        return repos.filter((repo) => {
            if (!repo) return false;
            const counts = repo.counts || {};
            return Boolean(repo.dirty || counts.staged || counts.unstaged || counts.untracked || counts.conflicted);
        });
    }

    buildRepoTree() {
        const root = { id: '/', name: this.state.reposRoot, children: new Map(), repos: [], counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } };
        const repos = this.getDisplayedRepoOverviews();

        const addCounts = (target, counts) => {
            const c = counts || {};
            target.counts.staged += c.staged || 0;
            target.counts.unstaged += c.unstaged || 0;
            target.counts.untracked += c.untracked || 0;
            target.counts.conflicted += c.conflicted || 0;
        };

        for (const repo of repos) {
            const rel = String(repo.relativePath || repo.name || '').replace(/^\/+/, '');
            const parts = rel.split('/').filter(Boolean);
            let node = root;
            for (let i = 0; i < Math.max(0, parts.length - 1); i += 1) {
                const part = parts[i];
                const nextId = node.id === '/' ? part : `${node.id}/${part}`;
                if (!node.children.has(part)) {
                    node.children.set(part, { id: nextId, name: part, children: new Map(), repos: [], counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } });
                }
                node = node.children.get(part);
                addCounts(node, repo.counts);
            }
            node.repos.push(repo);
            addCounts(node, repo.counts);
            addCounts(root, repo.counts);
        }
        return root;
    }

    async loadRepoOverviews({ force = false } = {}) {
        const now = Date.now();
        if (!force && this.repoOverviewCache.list && now - this.repoOverviewCache.at < 1500) {
            this.state.repoOverviews = this.repoOverviewCache.list;
            this.renderRepoOverviews(this.state.repoOverviews);
            return;
        }
        if (this.state.repoOverviewsLoading) return;
        this.state.repoOverviewsLoading = true;
        this.renderRepoOverviews([]);
        try {
            const payload = parseJsonToolResult(await this.callTool('git_repos_overview', { path: this.state.reposRoot })) || {};
            const results = Array.isArray(payload.repos) ? payload.repos : [];
            this.state.repoOverviews = results;
            this.repoOverviewCache = { at: now, list: results };
            this.applyDefaultRepoTreeExpansion();
            this.renderRepoOverviews(results);
        } catch (error) {
            try {
                const listingText = await this.callTool('list_directory_detailed', { path: this.state.reposRoot });
                const entries = parseDetailedDirectoryListing(listingText);
                const results = (entries || [])
                    .filter((entry) => entry && entry.type === 'directory' && entry.name && !String(entry.name).startsWith('.'))
                    .map((entry) => ({
                        name: entry.name,
                        path: joinPath(this.state.reposRoot, entry.name),
                        ok: true,
                        branch: null,
                        counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
                        sample: { staged: [], unstaged: [], untracked: [], conflicted: [] }
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));
                this.state.repoOverviews = results;
                this.repoOverviewCache = { at: now, list: results };
                this.applyDefaultRepoTreeExpansion();
                this.renderRepoOverviews(results);
                this.setStatusLine(`Loaded repositories list (status unavailable): ${normalizeErrorMessage(error)}`, true);
            } catch (fallbackError) {
                this.state.repoOverviews = [];
                this.renderRepoOverviews([]);
                this.setStatusLine(normalizeErrorMessage(fallbackError) || normalizeErrorMessage(error), true);
            }
        } finally {
            this.state.repoOverviewsLoading = false;
            this.renderRepoOverviews(this.state.repoOverviews);
        }
    }

    applyDefaultRepoTreeExpansion() {
        const repos = this.getDisplayedRepoOverviews();
        const expanded = { '/': true };
        for (const repo of repos) {
            const counts = repo?.counts || {};
            const isDirty = Boolean(repo?.dirty || counts.staged || counts.unstaged || counts.untracked || counts.conflicted);
            if (!isDirty) continue;
            const rel = String(repo.relativePath || repo.name || '').replace(/^\/+/, '');
            const parts = rel.split('/').filter(Boolean);
            let current = '';
            for (let i = 0; i < Math.max(0, parts.length - 1); i += 1) {
                current = current ? `${current}/${parts[i]}` : parts[i];
                expanded[current] = true;
            }
        }
        this.state.repoTreeExpanded = expanded;
    }

    renderRepoOverviews(overviews) {
        const section = this.element.querySelector('#gitRepoCandidatesSection');
        const container = this.element.querySelector('#gitRepoCandidatesList');
        if (!section || !container) return;

        container.innerHTML = '';
        const items = Array.isArray(overviews) ? overviews : [];
        const show = true;
        section.style.display = show ? '' : 'none';

        if (this.state.repoOverviewsLoading && items.length === 0) {
            const loading = document.createElement('div');
            loading.className = 'git-empty';
            loading.textContent = 'Loading repositories…';
            container.appendChild(loading);
            return;
        }

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'git-empty';
            empty.textContent = `No repositories found under ${this.state.reposRoot}.`;
            container.appendChild(empty);
            return;
        }

        const dirty = this.getDisplayedRepoOverviews();
        if (dirty.length === 0 && !this.state.repoOverviewsLoading) {
            const empty = document.createElement('div');
            empty.className = 'git-empty';
            empty.textContent = 'No repositories with changes.';
            container.appendChild(empty);
            return;
        }

        const tree = this.buildRepoTree();
        const expandedMap = this.state.repoTreeExpanded || {};

        const renderFolder = (node, depth = 0) => {
            const folderId = node.id;

            const wrapper = document.createElement('div');
            wrapper.className = 'git-repo-row';

            const row = document.createElement('div');
            row.className = 'git-change-row';

            const left = document.createElement('div');
            left.className = 'git-repo-row-header';
            left.style.paddingLeft = `${Math.min(24, depth * 12)}px`;

            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'secondary git-folder-toggle';
            expandBtn.dataset.folderId = folderId;
            expandBtn.setAttribute('data-local-action', 'toggleRepoFolderExpanded');
            const isExpanded = expandedMap[folderId] === true;
            expandBtn.textContent = isExpanded ? '▾' : '▸';

            const label = document.createElement('div');
            label.className = 'git-folder-label';
            const badge = `S:${node.counts.staged} U:${node.counts.unstaged} N:${node.counts.untracked}${node.counts.conflicted ? ` C:${node.counts.conflicted}` : ''}`;
            label.textContent = `${folderId === '/' ? this.state.reposRoot : node.name} · ${badge}`;

            left.appendChild(expandBtn);
            left.appendChild(label);

            row.appendChild(left);
            wrapper.appendChild(row);

            if (!isExpanded) {
                container.appendChild(wrapper);
                return;
            }

            // Render repos at this level
            for (const repo of node.repos || []) {
                const repoWrapper = document.createElement('div');
                repoWrapper.className = 'git-repo-row';

                const repoRow = document.createElement('div');
                repoRow.className = 'git-change-row';

                const repoLeft = document.createElement('div');
                repoLeft.className = 'git-repo-row-header';
                repoLeft.style.paddingLeft = `${Math.min(36, (depth + 1) * 12)}px`;

                const repoCheckbox = document.createElement('input');
                repoCheckbox.type = 'checkbox';
                repoCheckbox.setAttribute('data-local-action', 'toggleRepoAllChangesCheckbox');
                repoCheckbox.dataset.repoPath = repo.path;
                const changedPaths = Array.isArray(repo?.changesAll)
                    ? repo.changesAll.map((c) => String(c?.path || '')).filter(Boolean)
                    : [];
                const selectedCount = changedPaths.reduce((acc, p) => acc + (this.isFileSelected(repo.path, p) ? 1 : 0), 0);
                const any = selectedCount > 0;
                repoCheckbox.checked = changedPaths.length > 0 && selectedCount === changedPaths.length;
                repoCheckbox.indeterminate = any && selectedCount < changedPaths.length;

                const changesToggle = document.createElement('button');
                changesToggle.type = 'button';
                changesToggle.className = 'secondary git-tree-collapse';
                changesToggle.dataset.repoPath = repo.path;
                changesToggle.setAttribute('data-local-action', 'toggleRepoChanges');
                const isExpanded = this.isRepoChangesExpanded(repo.path);
                changesToggle.textContent = isExpanded ? '▾' : '▸';

                const counts = repo.counts || { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
                const repoBadge = repo.ok
                    ? `S:${counts.staged} U:${counts.unstaged} N:${counts.untracked}${counts.conflicted ? ` C:${counts.conflicted}` : ''}`
                    : 'not git';
                const label = document.createElement('div');
                label.className = 'git-change-button';
                label.textContent = `${repo.name} · ${repoBadge}${repo.branch ? ` · ${repo.branch}` : ''}`;
                repoLeft.appendChild(changesToggle);
                repoLeft.appendChild(repoCheckbox);
                repoLeft.appendChild(label);

                const info = document.createElement('div');
                info.className = 'git-info-button';
                info.setAttribute('role', 'button');
                info.setAttribute('tabindex', '0');
                const summary = this.formatRepoSummary(repo);
                info.dataset.tooltip = summary;
                info.title = summary;
                info.setAttribute('aria-label', summary);
                info.textContent = 'i';
                repoLeft.appendChild(info);
                repoRow.appendChild(repoLeft);

                repoWrapper.appendChild(repoRow);

                const hasChanges = Boolean(repo?.dirty || counts.staged || counts.unstaged || counts.untracked || counts.conflicted);
                if (hasChanges && this.isRepoChangesExpanded(repo.path)) {
                    const changesTree = this.renderRepoChangesTree(repo);
                    if (changesTree) {
                        repoWrapper.appendChild(changesTree);
                    }
                }

                wrapper.appendChild(repoWrapper);
            }

            const childNames = Array.from(node.children.keys()).sort((a, b) => a.localeCompare(b));
            for (const childName of childNames) {
                renderFolder(node.children.get(childName), depth + 1);
            }

            container.appendChild(wrapper);
        };

        renderFolder(tree, 0);
    }

    formatRepoSummary(repo) {
        return formatRepoSummary(repo);
    }

    renderRepoChangesTree(repo) {
        return renderRepoChangesTree(repo, {
            isFileSelected: (repoPath, filePath) => this.isFileSelected(repoPath, filePath),
            getAncestorCoveringPrefix: (repoPath, prefix) => this.getAncestorCoveringPrefix(repoPath, prefix),
            getCoveringPrefix: (repoPath, prefix) => this.getCoveringPrefix(repoPath, prefix),
            isFolderExpanded: (repoPath, prefix) => this.isTreeFolderExpanded(repoPath, prefix)
        });
    }

    refreshActiveRowStyles() {
        const activePath = this.state.selectedPath;
        const activeRepo = this.state.selectedRepoPath || this.state.repoPath;
        const items = this.element.querySelectorAll('.git-tree-file[data-local-action="openDiff"]');
        items.forEach((el) => {
            const isActive = Boolean(activePath && el.dataset.filePath === activePath && (!activeRepo || el.dataset.repoPath === activeRepo));
            el.classList.toggle('active', isActive);
            el.closest?.('.git-tree-file-row')?.classList.toggle('active', isActive);
        });
    }

    updateCommitButtons() {
        const actionsButton = this.element.querySelector('#gitActionsButton');
        const messageOk = Boolean((this.state.commitMessage || '').trim()) || this.state.amend;
        const selectedRepos = Array.from(new Set([
            ...Object.entries(this.state.selectedFilesByRepo || {})
                .filter(([, entry]) => (entry?.files && entry.files.size > 0) || (entry?.prefixes && entry.prefixes.size > 0))
                .map(([repoPath]) => repoPath)
        ]));
        const repoOk = this.state.repoInfoOk !== false;
        const identityBlocking = Boolean(this.state.identityPrompt?.visible);
        const authBlocking = Boolean(this.state.authPrompt?.visible);
        const hasSelection = selectedRepos.length > 0;
        const commitAllowed = !identityBlocking && !authBlocking && hasSelection && messageOk;
        const pushAllowed = !identityBlocking && !authBlocking && repoOk;
        if (actionsButton) {
            actionsButton.disabled = !commitAllowed && !pushAllowed;
        }
    }

    getAllChangedPathsForRepo(repoPath) {
        const repo = (this.state.repoOverviews || []).find((r) => r?.path === repoPath) || null;
        const rows = Array.isArray(repo?.changesAll) ? repo.changesAll : [];
        return rows.map((r) => String(r?.path || '')).filter(Boolean);
    }

    reconcileSelectedDiffWithChanges() {
        const filePath = this.state.selectedPath;
        if (!filePath) return;

        const repoPath = this.state.selectedRepoPath || this.state.repoPath;
        if (!repoPath || isReposRootPath(repoPath, this.state.reposRoot)) {
            this.clearSelectedDiff();
            return;
        }

        const changed = this.getAllChangedPathsForRepo(repoPath);
        if (changed.length > 0 && !changed.includes(filePath)) {
            this.clearSelectedDiff();
        }
    }

    clearSelectedDiff() {
        this.state.selectedPath = null;
        this.state.selectedSection = null;
        this.renderDiff('', { filePath: null, section: null });
        this.refreshActiveRowStyles();
    }

    getPathsForCommitInRepo(repoPath) {
        const changed = this.getAllChangedPathsForRepo(repoPath);
        const changedSet = new Set(changed);
        const entry = this.state.selectedFilesByRepo?.[repoPath] || null;
        const out = new Set();
        for (const file of entry?.files || []) {
            if (changedSet.has(file)) out.add(file);
        }
        const prefixes = Array.from(entry?.prefixes || []);
        for (const prefix of prefixes) {
            if (prefix === '*') {
                for (const p of changed) out.add(p);
                continue;
            }
            for (const p of changed) {
                if (p.startsWith(prefix)) out.add(p);
            }
        }
        return Array.from(out);
    }

    showGitAuthPrompt(repoPath, pendingAction, { message = '' } = {}) {
        const remembered = getRememberedGitPat();
        this.state.authPrompt = {
            visible: true,
            repoPath,
            pendingAction: pendingAction || null,
            token: '',
            remember: Boolean(remembered)
        };
        this.syncStaticUI();
        this.updateAuthPrompt({ focus: 'token' });
        this.updateCommitButtons();
        this.setStatusLine(message || (remembered ? 'A token is already saved. Paste a new token to replace it.' : 'Authentication required to push.'), true);
    }

    openGitTokenPrompt() {
        this.closeSettingsMenu();
        this.showGitAuthPrompt(this.state.repoPath, null, { message: '' });
    }

    openGitIdentityPrompt() {
        this.closeSettingsMenu();
        let repoPath = this.state.selectedRepoPath || this.state.repoPath;
        if (!repoPath || isReposRootPath(repoPath, this.state.reposRoot)) {
            const selected = this.getSelectedReposForBatch();
            repoPath = selected[0] || '';
        }
        if (!repoPath) {
            this.setStatusLine('Select a repository to set identity.', true);
            return;
        }
        this.state.identityPrompt = {
            visible: true,
            repoPath,
            pendingAction: null,
            name: this.state.identityPrompt?.name || '',
            email: this.state.identityPrompt?.email || ''
        };
        this.syncStaticUI();
        this.updateIdentityPrompt({ focus: 'name' });
        this.updateCommitButtons();
    }

    cancelGitToken() {
        this.state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        this.syncStaticUI();
        this.updateCommitButtons();
        this.setStatusLine('Cancelled.', true);
    }

    cancelGitIdentity() {
        this.state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
        this.syncStaticUI();
        this.updateCommitButtons();
        this.setStatusLine('Cancelled.', true);
    }

    async saveGitToken(payload = {}) {
        const pending = this.state.authPrompt?.pendingAction;
        const token = String(payload.token ?? this.state.authPrompt?.token ?? '').trim();
        const remember = typeof payload.remember === 'boolean' ? payload.remember : Boolean(this.state.authPrompt?.remember);
        this.state.authPrompt = {
            ...this.state.authPrompt,
            token,
            remember
        };
        if (!token) {
            this.state.authPrompt = {
                ...this.state.authPrompt,
                visible: true,
                token: '',
                remember
            };
            this.syncStaticUI();
            this.updateAuthPrompt({ focus: 'token' });
            this.updateCommitButtons();
            this.setStatusLine('Enter a token to continue.', true);
            return;
        }
        if (remember) setRememberedGitPat(token);
        else setRememberedGitPat('');

        this.state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        this.syncStaticUI();
        this.updateCommitButtons();
        this.setStatusLine(pending?.type === 'pull' ? 'Retrying pull…' : 'Retrying push…');
        try {
            if (pending?.type === 'push') {
                if (pending.mode === 'batch') {
                    const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                    await this.pushRepos(list, { token });
                } else {
                    await this.push({ silent: false, token });
                }
            } else if (pending?.type === 'pull') {
                const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                await this.pullRepos(list, { token });
            }
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        }
    }

    async gitPushWithToken(repoPath, token) {
        const payload = { path: repoPath };
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await this.callTool('git_push', payload);
    }

    async gitPullWithToken(repoPath, token) {
        const mode = this.state.pullMode || 'ffOnly';
        const payload = { path: repoPath };
        if (mode === 'rebase') {
            payload.rebase = true;
            payload.ffOnly = false;
        } else if (mode === 'merge') {
            payload.rebase = false;
            payload.ffOnly = false;
        } else {
            payload.rebase = false;
            payload.ffOnly = true;
        }
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await this.callTool('git_pull', payload);
    }

    async pushRepos(repoPaths, { token = null } = {}) {
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        const effectiveToken = String(token || '').trim() || getRememberedGitPat();
        for (const repoPath of list) {
            try {
                await this.gitPushWithToken(repoPath, effectiveToken);
            } catch (error) {
                const msg = normalizeErrorMessage(error);
                if (isGitAuthError(msg)) {
                    if (!effectiveToken) {
                        this.showGitAuthPrompt(repoPath, { type: 'push', mode: 'batch', repoPaths: list }, { message: msg });
                        return false;
                    }
                    this.setStatusLine(`${msg} (A token is already saved. Use “Token” to update it.)`, true);
                    return false;
                }
                throw error;
            }
        }
        return true;
    }

    async pullRepos(repoPaths, { token = null } = {}) {
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        const effectiveToken = String(token || '').trim() || getRememberedGitPat();
        for (const repoPath of list) {
            try {
                await this.gitPullWithToken(repoPath, effectiveToken);
            } catch (error) {
                const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
                if (isGitIdentityError(msg)) {
                    await this.ensureGitIdentityOrPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths: list });
                    return false;
                }
                if (isGitAuthError(msg)) {
                    if (!effectiveToken) {
                        this.showGitAuthPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths: list }, { message: msg });
                        return false;
                    }
                    this.setStatusLine(`${msg} (A token is already saved. Use “Token” to update it.)`, true);
                    return false;
                }
                throw error;
            }
        }
        return true;
    }

    async ensureGitIdentityOrPrompt(repoPath, pendingAction) {
        if (!repoPath) return false;
        try {
            const payload = parseJsonToolResult(await this.callTool('git_identity', { path: repoPath })) || {};
            if (payload.ok) return true;
        } catch (_) {
            // ignore and prompt
        }

        this.state.identityPrompt = {
            visible: true,
            repoPath,
            pendingAction: pendingAction || null,
            name: '',
            email: ''
        };
        this.syncStaticUI();
        this.updateIdentityPrompt({ focus: 'name' });
        this.updateCommitButtons();
        this.setStatusLine('Set git user.name and user.email to continue.', true);
        return false;
    }

    async saveGitIdentity(payload = {}) {
        const repoPath = this.state.identityPrompt?.repoPath;
        if (!repoPath) return;
        const name = String(payload.name ?? this.state.identityPrompt?.name ?? '').trim();
        const email = String(payload.email ?? this.state.identityPrompt?.email ?? '').trim();
        this.state.identityPrompt = {
            ...this.state.identityPrompt,
            name,
            email
        };
        if (!name || !email) {
            this.state.identityPrompt = {
                ...this.state.identityPrompt,
                visible: true,
                name,
                email
            };
            this.syncStaticUI();
            this.updateIdentityPrompt({ focus: !name ? 'name' : 'email' });
            this.updateCommitButtons();
            this.setStatusLine('Enter name and email.', true);
            return;
        }

        const nextScope = String(payload.scope || '').trim() || 'local';
        try {
            await this.callTool('git_set_identity', {
                path: repoPath,
                scope: nextScope === 'global' ? 'global' : 'local',
                name,
                email
            });
            const pending = this.state.identityPrompt?.pendingAction;
            this.state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
            this.syncStaticUI();
            this.updateCommitButtons();
            this.setStatusLine('Git identity saved.');

            if (pending?.type === 'commit') {
                if (pending.mode === 'batch') await this.commitSelectedRepos();
                else await this.commitSelectedRepos();
            } else if (pending?.type === 'push') {
                await this.push({ silent: false });
            } else if (pending?.type === 'pull') {
                await this.pullSelectedRepos();
            }
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        }
    }

    getSelectedReposForBatch() {
        return Array.from(new Set([
            ...Object.entries(this.state.selectedFilesByRepo || {})
                .filter(([, entry]) => (entry?.files && entry.files.size > 0) || (entry?.prefixes && entry.prefixes.size > 0))
                .map(([repoPath]) => repoPath)
        ]));
    }

    async commitSelectedRepos() {
        const selected = this.getSelectedReposForBatch();
        const message = (this.state.commitMessage || '').trim();
        if (!this.state.amend && !message) {
            this.setStatusLine('Enter a commit message.', true);
            return;
        }
        if (!selected.length) return;
        const shouldPush = (this.state.commitMode || 'commit') === 'commitPush';
        this.setStatusLine(shouldPush ? `Committing & pushing ${selected.length} repo(s)…` : `Committing ${selected.length} repo(s)…`);
        return withGlobalLoader(async () => {
            try {
                for (const repoPath of selected) {
                    const identityOk = await this.ensureGitIdentityOrPrompt(repoPath, { type: 'commit', mode: 'batch', repoPaths: selected });
                    if (!identityOk) return;
                    const list = this.getPathsForCommitInRepo(repoPath);
                    if (!list.length) continue;
                    await this.callTool('git_stage', { path: repoPath, files: list });
                    const after = parseJsonToolResult(await this.callTool('git_status', { path: repoPath }));
                    const afterStatus = after?.status || after || {};
                    if (!(afterStatus.staged || []).length) {
                        continue;
                    }
                    await this.callTool('git_commit', {
                        path: repoPath,
                        message,
                        amend: Boolean(this.state.amend),
                        signoff: Boolean(this.state.signoff)
                    });
                    if (shouldPush) {
                        const token = getRememberedGitPat();
                        try {
                            await this.gitPushWithToken(repoPath, token);
                        } catch (error) {
                            const msg = normalizeErrorMessage(error);
                            if (isGitAuthError(msg)) {
                                if (!token) {
                                    this.showGitAuthPrompt(repoPath, { type: 'push', mode: 'batch', repoPaths: [repoPath] }, { message: msg });
                                    return;
                                }
                                this.setStatusLine(`${msg} (A token is already saved. Use “Token” to update it.)`, true);
                                return;
                            }
                            throw error;
                        }
                    }
                }
                this.state.selectedFilesByRepo = {};
                this.state.commitMessage = '';
                const commitMessage = this.element.querySelector('#gitCommitMessage');
                if (commitMessage) commitMessage.value = '';
                this.diffCache.clear();
                await this.loadRepoOverviews({ force: true });
                await this.refreshAll({ force: true });
                this.setStatusLine('Done.');
            } catch (error) {
                this.setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    }

    async selectFile(filePath, section, repoPath = null) {
        if (!filePath) return;
        if (repoPath) {
            this.state.selectedRepoPath = repoPath;
        }
        this.state.selectedPath = filePath;
        this.state.selectedSection = section || null;
        this.refreshActiveRowStyles();
        await this.loadDiffForSelection();
    }

    buildDiffCacheKey(repoPath, section, filePath) {
        return `${repoPath || 'repo'}::${section || 'unknown'}::${filePath}`;
    }

    async loadDiffForSelection() {
        const filePath = this.state.selectedPath;
        if (!filePath) return;
        const section = this.state.selectedSection;
        const repoPath = this.state.selectedRepoPath || this.state.repoPath;
        const cachedKey = this.buildDiffCacheKey(repoPath, section, filePath);
        const cached = this.diffCache.get(cachedKey);
        if (cached) {
            this.renderDiff(cached, { filePath, section });
            return;
        }

        this.renderDiff('Loading diff…', { filePath, section, loading: true });
        try {
            const text = await this.callTool('git_diff', { path: repoPath, file: filePath, cached: false, ref: 'HEAD' });
            const diffText = text || '(no diff)';
            this.diffCache.set(cachedKey, diffText);
            this.renderDiff(diffText, { filePath, section });
        } catch (error) {
            const message = normalizeErrorMessage(error);
            this.renderDiff(message, { filePath, section, isError: true });
        }
    }

    getDiffViewer() {
        return this.element.querySelector('git-diff-viewer')?.webSkelPresenter || null;
    }

    renderDiff(text, { filePath, section, loading = false, isError = false } = {}) {
        const viewer = this.getDiffViewer();
        if (!viewer || typeof viewer.setDiff !== 'function') return;
        viewer.setDiff(text, { filePath, section, loading, isError });
    }

    async commit() {
        await this.commitSelectedRepos();
    }

    async push({ silent = false, token = null } = {}) {
        const identityOk = await this.ensureGitIdentityOrPrompt(this.state.repoPath, { type: 'push', mode: 'single' });
        if (!identityOk) {
            return;
        }
        if (!silent) {
            this.setStatusLine('Pushing…');
        }
        return withGlobalLoader(async () => {
            try {
                const effectiveToken = String(token || '').trim() || getRememberedGitPat();
                await this.gitPushWithToken(this.state.repoPath, effectiveToken);
                if (!silent) {
                    this.setStatusLine('Pushed.');
                }
            } catch (error) {
                const msg = normalizeErrorMessage(error);
                if (isGitAuthError(msg)) {
                    const effectiveToken = String(token || '').trim() || getRememberedGitPat();
                    if (!effectiveToken) {
                        this.showGitAuthPrompt(this.state.repoPath, { type: 'push', mode: 'batch', repoPaths: [this.state.repoPath] }, { message: msg });
                    } else {
                        this.setStatusLine(`${msg} (A token is already saved. Use “Token” to update it.)`, true);
                    }
                } else {
                    this.setStatusLine(msg, true);
                }
            }
        });
    }

    async pullSelectedRepos() {
        const selected = this.getSelectedReposForBatch();
        if (!selected.length) {
            this.setStatusLine('Select at least one file/repo to pull.', true);
            return;
        }
        const mode = this.state.pullMode || 'ffOnly';
        // Merge/rebase can create commits (merge commit or rewritten commits), so identity must be set.
        if (mode !== 'ffOnly') {
            for (const repoPath of selected) {
                const ok = await this.ensureGitIdentityOrPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths: selected });
                if (!ok) return;
            }
        }
        this.setStatusLine(`Pulling ${selected.length} repo(s)…`);
        try {
            const ok = await this.pullRepos(selected);
            if (!ok) return;
            this.diffCache.clear();
            await this.loadRepoOverviews({ force: true });
            await this.refreshAll({ force: true });
            this.setStatusLine('Pulled.');
        } catch (error) {
            this.setStatusLine(humanizeGitError(normalizeErrorMessage(error), { action: 'pull' }), true);
        }
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
