import { createGitCommitActions } from "./git-commit-modal-actions.js";
import { createGitCommitDialog } from "./git-commit-modal-dialog.js";
import { createGitCommitDiff } from "./git-commit-modal-diff.js";
import { createGitCommitRepo } from "./git-commit-modal-repo.js";
import { createGitCommitService } from "./git-commit-modal-service.js";
import { createGitCommitState } from "./git-commit-modal-state.js";
import { createGitCommitUI } from "./git-commit-modal-ui.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";
import { joinPath } from "../../pages/file-exp/file-exp-utils.js";
import { normalizeErrorMessage } from "./git-commit-modal-utils.js";

export class GitCommitModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.statusCache = { at: 0, payload: null };
        this.diffCache = new Map();
        this.repoOverviewCache = { at: 0, list: [] };
        this.dialogState = { isFullscreen: false, prev: null };
        this.menuAbortController = null;
        this.stateStore = createGitCommitState(props);
        this.state = this.stateStore.state;
        this.service = createGitCommitService({
            callTool: this.callTool.bind(this),
            callAgentTool: this.callAgentTool.bind(this)
        });
        this.repo = createGitCommitRepo({
            element: this.element,
            state: this.state,
            service: this.service,
            statusCache: this.statusCache,
            repoOverviewCache: this.repoOverviewCache,
            setStatusLine: this.setStatusLine.bind(this),
            updateCommitButtons: this.updateCommitButtons.bind(this),
            clearSelectedDiff: this.clearSelectedDiff.bind(this)
        });
        this.diff = createGitCommitDiff({
            element: this.element,
            state: this.state,
            service: this.service,
            diffCache: this.diffCache
        });
        this.dialog = createGitCommitDialog({
            element: this.element,
            dialogState: this.dialogState
        });
        this.ui = createGitCommitUI({
            element: this.element,
            state: this.state,
            setMenuAbortController: (controller) => {
                this.menuAbortController = controller;
            },
            runGitAction: this.runGitAction.bind(this),
            openDiff: this.openDiff.bind(this),
            applyRepoPathFromInput: this.applyRepoPathFromInput.bind(this),
            saveGitToken: this.saveGitToken.bind(this),
            cancelGitToken: this.cancelGitToken.bind(this),
            saveGitIdentity: this.saveGitIdentity.bind(this),
            cancelGitIdentity: this.cancelGitIdentity.bind(this),
            saveGitIgnore: this.saveGitIgnore.bind(this),
            cancelGitIgnore: this.cancelGitIgnore.bind(this),
            setIgnoreMode: this.setIgnoreMode.bind(this),
            setIgnoreAnchor: this.setIgnoreAnchor.bind(this),
            openIgnoreForDiff: this.openIgnoreForDiff.bind(this),
            closeFileMenus: this.closeFileMenus.bind(this),
            closeModal: this.closeModal.bind(this)
        });
        this.actions = createGitCommitActions({
            getState: () => this.state,
            service: this.service,
            setStatusLine: this.setStatusLine.bind(this),
            updateCommitButtons: this.updateCommitButtons.bind(this),
            syncStaticUI: this.syncStaticUI.bind(this),
            updateIdentityPrompt: this.updateIdentityPrompt.bind(this),
            updateAuthPrompt: this.updateAuthPrompt.bind(this),
            updateIgnorePrompt: this.updateIgnorePrompt.bind(this),
            closeActionsMenu: this.closeActionsMenu.bind(this),
            closeSettingsMenu: this.closeSettingsMenu.bind(this),
            getSelectedReposForBatch: () => this.getSelectedReposForBatch(),
            getPathsForCommitInRepo: this.getPathsForCommitInRepo.bind(this),
            setCommitMessage: this.setCommitMessage.bind(this),
            clearCommitMessageInput: this.clearCommitMessageInput.bind(this),
            clearDiffCache: () => this.diffCache.clear(),
            loadRepoInfo: this.loadRepoInfo.bind(this),
            loadRepoOverviews: this.loadRepoOverviews.bind(this),
            refreshAll: this.refreshAll.bind(this)
        });
        this.invalidate();
    }

    beforeRender() {}

    getSelectedReposForBatch() {
        return this.stateStore.getSelectedReposForBatch();
    }

    clearCommitMessageInput() {
        const commitMessage = this.element.querySelector('#gitCommitMessage');
        if (commitMessage) commitMessage.value = '';
    }

    setCommitMessage(message) {
        const value = String(message || '').trim();
        this.state.commitMessage = value;
        const commitMessage = this.element.querySelector('#gitCommitMessage');
        if (commitMessage) {
            commitMessage.value = value;
            commitMessage.focus();
        }
    }

    afterUnload() {
        this.menuAbortController?.abort();
        this.menuAbortController = null;
    }

    peekSelectedFilesEntry(repoPath) {
        return this.repo.peekSelectedFilesEntry(repoPath);
    }

    afterRender() {
        this.bindEvents();
        this.syncStaticUI();
        this.dialog.ensureDialogResizable();
        // On open: force-load repos overview so the user immediately sees changes across all repos.
        this.refreshAll({ force: true });
    }

    toggleFullscreen() {
        return this.dialog.toggleFullscreen();
    }

    bindEvents() {
        return this.ui.bindEvents();
    }

    closeModalAction() {
        this.closeModal();
    }

    refreshAction() {
        this.refreshAll({ force: true });
    }

    updateCommitMessage(element) {
        return this.ui.updateCommitMessage(element);
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
        this.togglePrefixSelection(repoPath, '*', Boolean(element.checked));
    }

    openDiff(element) {
        const repoPath = element?.dataset?.repoPath || null;
        const filePath = element?.dataset?.filePath;
        const section = element?.dataset?.section || null;
        if (!filePath) return;
        this.selectFile(filePath, section, repoPath);
    }

    openIgnoreForFile(element) {
        const repoPath = element?.dataset?.repoPath || null;
        const filePath = element?.dataset?.filePath;
        if (!repoPath || !filePath) return;
        this.closeFileMenus();
        this.actions.openGitIgnorePrompt({ repoPath, paths: [filePath], source: 'selection' });
    }

    openStopTrackingForFile(element) {
        const repoPath = element?.dataset?.repoPath || null;
        const filePath = element?.dataset?.filePath;
        if (!repoPath || !filePath) return;
        this.closeFileMenus();
        this.actions.openGitIgnorePrompt({ repoPath, paths: [filePath], source: 'selection', stopTracking: true });
    }

    async deleteFile(element) {
        const repoPath = element?.dataset?.repoPath || null;
        const filePath = element?.dataset?.filePath;
        if (!repoPath || !filePath) return;
        this.closeFileMenus();
        const row = element?.closest?.('.git-tree-file-row');
        const isDeleted = Boolean(row?.classList?.contains('is-deleted'));
        const fullPath = joinPath(repoPath, filePath);
        try {
            this.setStatusLine(isDeleted ? `Staging deletion for ${filePath}...` : `Deleting ${filePath}...`);
            if (!isDeleted) {
                await this.service.deleteFile(fullPath);
            }
            this.toggleFileSelection(repoPath, filePath, null, true);
            await this.service.gitStage(repoPath, [filePath]);
            await this.refreshAll({ force: true });
            this.setStatusLine(isDeleted ? `Deletion staged: ${filePath}` : `Deleted ${filePath}.`);
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        }
    }

    openIgnoreForDiff(payload = {}) {
        const repoPath = payload.repoPath || null;
        const filePath = payload.filePath;
        if (!repoPath || !filePath) return;
        this.actions.openGitIgnorePrompt({ repoPath, paths: [filePath], source: 'selection' });
    }

    toggleFileMenu(element) {
        const menu = element?.closest?.('.git-file-menu');
        if (!menu) return;
        const willOpen = !menu.classList.contains('open');
        this.closeFileMenus();
        if (willOpen) {
            menu.classList.add('open');
            const firstItem = menu.querySelector('.git-file-menu-item');
            if (firstItem) {
                setTimeout(() => firstItem.focus(), 0);
            }
        }
    }

    closeFileMenus() {
        const menus = this.element.querySelectorAll('.git-file-menu.open');
        menus.forEach((menu) => menu.classList.remove('open'));
    }

    toggleRepoFolderExpanded(element) {
        const folderId = element?.dataset?.folderId;
        if (!folderId) return;
        this.toggleFolderExpanded(folderId);
    }

    syncStaticUI() {
        return this.ui.syncStaticUI();
    }

    updateIdentityPrompt(options = {}) {
        return this.ui.updateIdentityPrompt(options);
    }

    updateAuthPrompt(options = {}) {
        return this.ui.updateAuthPrompt(options);
    }

    updateIgnorePrompt(options = {}) {
        return this.ui.updateIgnorePrompt(options);
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
        this.statusCache.at = 0;
        this.statusCache.payload = null;
        this.diffCache.clear();
        this.state.selectedPath = null;
        this.state.selectedSection = null;
        this.state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
        this.state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        this.state.ignorePrompt = {
            visible: false,
            repoPath: null,
            mode: 'file',
            anchor: true,
            patterns: '',
            paths: [],
            source: 'manual',
            stopTracking: false
        };
        this.closeActionsMenu();
        this.syncStaticUI();
        await this.refreshAll({ force: true });
    }

    toggleActionsMenu() {
        return this.ui.toggleActionsMenu();
    }

    closeActionsMenu() {
        return this.ui.closeActionsMenu();
    }

    toggleSettingsMenu() {
        return this.ui.toggleSettingsMenu();
    }

    closeSettingsMenu() {
        return this.ui.closeSettingsMenu();
    }

    runGitAction(element, mode) {
        return this.actions.runGitAction(element, mode);
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
        return this.actions.generateCommitMessage();
    }

    async refreshAll({ force = false } = {}) {
        return this.repo.refreshAll({ force });
    }

    async loadRepoInfo({ force = false } = {}) {
        return this.repo.loadRepoInfo({ force });
    }

    applyRepoInfo(info) {
        return this.repo.applyRepoInfo(info);
    }

    getSelectedFilesEntry(repoPath) {
        return this.repo.getSelectedFilesEntry(repoPath);
    }

    isFileSelected(repoPath, filePath) {
        return this.repo.isFileSelected(repoPath, filePath);
    }

    toggleFileSelection(repoPath, filePath, section, isSelected) {
        return this.repo.toggleFileSelection(repoPath, filePath, section, isSelected);
    }

    getCoveringPrefix(repoPath, relativePath) {
        return this.repo.getCoveringPrefix(repoPath, relativePath);
    }

    getAncestorCoveringPrefix(repoPath, prefix) {
        return this.repo.getAncestorCoveringPrefix(repoPath, prefix);
    }

    togglePrefixSelection(repoPath, prefix, isSelected) {
        return this.repo.togglePrefixSelection(repoPath, prefix, isSelected);
    }

    toggleFolderExpanded(folderId) {
        return this.repo.toggleFolderExpanded(folderId);
    }

    toggleRepoChanges(element) {
        return this.repo.toggleRepoChanges(element);
    }

    isRepoChangesExpanded(repoPath) {
        return this.repo.isRepoChangesExpanded(repoPath);
    }

    toggleTreeFolder(element) {
        return this.repo.toggleTreeFolder(element);
    }

    isTreeFolderExpanded(repoPath, prefix) {
        return this.repo.isTreeFolderExpanded(repoPath, prefix);
    }

    getDisplayedRepoOverviews() {
        return this.repo.getDisplayedRepoOverviews();
    }

    buildRepoTree() {
        return this.repo.buildRepoTree();
    }

    async loadRepoOverviews({ force = false } = {}) {
        return this.repo.loadRepoOverviews({ force });
    }

    applyDefaultRepoTreeExpansion() {
        return this.repo.applyDefaultRepoTreeExpansion();
    }

    renderRepoOverviews(overviews) {
        return this.repo.renderRepoOverviews(overviews);
    }

    formatRepoSummary(repo) {
        return this.repo.formatRepoSummary(repo);
    }

    renderRepoChangesTree(repo) {
        return this.repo.renderRepoChangesTree(repo);
    }

    updateCommitButtons() {
        return this.ui.updateCommitButtons();
    }

    getAllChangedPathsForRepo(repoPath) {
        return this.repo.getAllChangedPathsForRepo(repoPath);
    }

    reconcileSelectedDiffWithChanges() {
        return this.repo.reconcileSelectedDiffWithChanges();
    }

    clearSelectedDiff() {
        return this.diff.clearSelectedDiff();
    }

    getPathsForCommitInRepo(repoPath) {
        return this.repo.getPathsForCommitInRepo(repoPath);
    }

    showGitAuthPrompt(repoPath, pendingAction, { message = '' } = {}) {
        return this.actions.showGitAuthPrompt(repoPath, pendingAction, { message });
    }

    openGitTokenPrompt() {
        return this.actions.openGitTokenPrompt();
    }

    openGitIdentityPrompt() {
        return this.actions.openGitIdentityPrompt();
    }

    openGitIgnorePrompt() {
        return this.actions.openGitIgnorePrompt();
    }

    cancelGitToken() {
        return this.actions.cancelGitToken();
    }

    cancelGitIdentity() {
        return this.actions.cancelGitIdentity();
    }

    cancelGitIgnore() {
        return this.actions.cancelGitIgnore();
    }

    async saveGitToken(payload = {}) {
        return this.actions.saveGitToken(payload);
    }

    async saveGitIgnore(payload = {}) {
        return this.actions.saveGitIgnore(payload);
    }

    setIgnoreMode(payload = {}) {
        return this.actions.setIgnoreMode(payload);
    }

    setIgnoreAnchor(payload = {}) {
        return this.actions.setIgnoreAnchor(payload);
    }

    async gitPushWithToken(repoPath, token) {
        return this.actions.gitPushWithToken(repoPath, token);
    }

    async gitPullWithToken(repoPath, token) {
        return this.actions.gitPullWithToken(repoPath, token);
    }

    async pushRepos(repoPaths, { token = null } = {}) {
        return this.actions.pushRepos(repoPaths, { token });
    }

    async pullRepos(repoPaths, { token = null } = {}) {
        return this.actions.pullRepos(repoPaths, { token });
    }

    async ensureGitIdentityOrPrompt(repoPath, pendingAction) {
        return this.actions.ensureGitIdentityOrPrompt(repoPath, pendingAction);
    }

    async saveGitIdentity(payload = {}) {
        return this.actions.saveGitIdentity(payload);
    }

    async commitSelectedRepos() {
        return this.actions.commitSelectedRepos();
    }

    async selectFile(filePath, section, repoPath = null) {
        return this.diff.selectFile(filePath, section, repoPath);
    }

    async commit() {
        return this.actions.commit();
    }

    async push({ silent = false, token = null } = {}) {
        return this.actions.push({ silent, token });
    }

    async pushSelectedRepos(repoPaths) {
        return this.actions.pushSelectedRepos(repoPaths);
    }

    async pullSelectedRepos() {
        return this.actions.pullSelectedRepos();
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
