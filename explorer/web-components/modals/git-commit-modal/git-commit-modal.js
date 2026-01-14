import { createGitCommitActions } from "./git-commit-modal-actions.js";
import { createGitCommitDialog } from "./git-commit-modal-dialog.js";
import { createGitCommitDiff } from "./git-commit-modal-diff.js";
import { createGitCommitRepo } from "./git-commit-modal-repo.js";
import { createGitCommitService } from "./git-commit-modal-service.js";
import { createGitCommitState } from "./git-commit-modal-state.js";
import { createGitCommitUI } from "./git-commit-modal-ui.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";
import { joinPath } from "../../pages/file-exp/file-exp-utils.js";
import { normalizeErrorMessage, parseJsonToolResult, normalizeSlashes, isReposRootPath } from "./git-commit-modal-utils.js";

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
            refreshAction: this.refreshAction.bind(this),
            generateCommitMessage: this.generateCommitMessage.bind(this),
            toggleRepoChanges: this.toggleRepoChanges.bind(this),
            toggleRepoFolderExpanded: this.toggleRepoFolderExpanded.bind(this),
            toggleTreeFolder: this.toggleTreeFolder.bind(this),
            toggleTreePrefixSelectionCheckbox: this.toggleTreePrefixSelectionCheckbox.bind(this),
            toggleTreeFileSelectionCheckbox: this.toggleTreeFileSelectionCheckbox.bind(this),
            toggleRepoAllChangesCheckbox: this.toggleRepoAllChangesCheckbox.bind(this),
            openIgnoreForFile: this.openIgnoreForFile.bind(this),
            openStopTrackingForFile: this.openStopTrackingForFile.bind(this),
            removeIgnoreForFile: this.removeIgnoreForFile.bind(this),
            rollbackFile: this.rollbackFile.bind(this),
            deleteFile: this.deleteFile.bind(this),
            saveGitCredentials: this.saveGitCredentials.bind(this),
            cancelGitCredentials: this.cancelGitCredentials.bind(this),
            saveGitIgnore: this.saveGitIgnore.bind(this),
            cancelGitIgnore: this.cancelGitIgnore.bind(this),
            setIgnoreMode: this.setIgnoreMode.bind(this),
            setIgnoreAnchor: this.setIgnoreAnchor.bind(this),
            openIgnoreForDiff: this.openIgnoreForDiff.bind(this),
            selectConflictFile: this.selectConflictFile.bind(this),
            applyConflictChoice: this.applyConflictChoice.bind(this),
            stageConflictFile: this.stageConflictFile.bind(this),
            refreshConflicts: this.refreshConflicts.bind(this),
            openConflictHelper: this.openConflictHelper.bind(this),
            closeModal: this.closeModal.bind(this),
            cancelConflictResolution: this.cancelConflictResolution.bind(this)
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
        this.ui.updateCommitMessage('');
    }

    setCommitMessage(message) {
        const value = String(message || '').trim();
        this.ui.updateCommitMessage(value);
        this.ui.focusCommitMessage?.();
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
        this.ensureCredentialsGate().then((gateActive) => {
            if (!gateActive) {
                // On open: force-load repos overview so the user immediately sees changes across all repos.
                this.refreshAll({ force: true });
            }
        });
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

    async resolveIdentityRepoPath() {
        const repoPath = this.state.selectedRepoPath || this.state.repoPath || '';
        if (repoPath && !isReposRootPath(repoPath, this.state.reposRoot)) {
            return repoPath;
        }
        const fromOverviews = (this.state.repoOverviews || [])
            .map((repo) => repo?.path)
            .find(Boolean);
        if (fromOverviews) return fromOverviews;
        try {
            const text = await this.service.gitReposOverview(this.state.reposRoot);
            const payload = parseJsonToolResult(text) || {};
            const repos = Array.isArray(payload.repos) ? payload.repos : [];
            const first = repos.map((repo) => repo?.path).find(Boolean);
            if (first) return first;
        } catch {
            // ignore
        }
        return repoPath || this.state.reposRoot || '';
    }

    async prefillCredentialsPanel() {
        const current = this.state.identityPrompt || {};
        let repoPath = current.repoPath || this.state.selectedRepoPath || this.state.repoPath || '';
        if (repoPath && isReposRootPath(repoPath, this.state.reposRoot)) {
            repoPath = '';
        }
        if (!repoPath) {
            repoPath = (this.state.repoOverviews || [])
                .map((repo) => repo?.path)
                .find((path) => path && !isReposRootPath(path, this.state.reposRoot)) || '';
        }
        if (!repoPath) return;

        let payload = null;
        try {
            payload = parseJsonToolResult(await this.service.gitIdentity(repoPath)) || {};
        } catch {
            payload = null;
        }
        const local = payload?.local || {};
        const global = payload?.global || {};
        const effective = payload?.effective || {};
        const name = local.name || effective.name || global.name || current.name || '';
        const email = local.email || effective.email || global.email || current.email || '';
        this.state.identityPrompt = {
            ...current,
            repoPath,
            name,
            email
        };
    }

    async ensureCredentialsGate() {
        let payload = null;
        try {
            payload = parseJsonToolResult(await this.service.gitIdentity(this.state.repoPath)) || {};
        } catch {
            payload = null;
        }
        if (payload?.ok) {
            if (this.state.credentialsGate) {
                this.state.credentialsGate = false;
                this.syncStaticUI();
            }
            return false;
        }

        const local = payload?.local || {};
        const global = payload?.global || {};
        const effective = payload?.effective || {};
        const name = local.name || effective.name || global.name || '';
        const email = local.email || effective.email || global.email || '';
        const repoPath = await this.resolveIdentityRepoPath();
        this.state.credentialsGate = true;
        this.state.identityPrompt = {
            visible: true,
            repoPath,
            pendingAction: null,
            name,
            email
        };
        this.syncStaticUI();
        this.updateIdentityPrompt({ focus: !name ? 'name' : (!email ? 'email' : 'name') });
        this.updateCommitButtons();
        this.setStatusLine('Set git user.name and user.email to continue.', true);
        return true;
    }

    refreshAction() {
        this.actions.refreshConflicts();
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
        const detail = element && !(element instanceof HTMLElement) ? element : null;
        const repoPath = detail?.repoPath || element?.dataset?.repoPath || null;
        const filePath = detail?.filePath || element?.dataset?.filePath;
        const section = detail?.section || element?.dataset?.section || null;
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

    async removeIgnoreForFile(element) {
        const repoPath = element?.dataset?.repoPath || null;
        const filePath = element?.dataset?.filePath;
        if (!repoPath || !filePath) return;
        this.closeFileMenus();
        const row = element?.closest?.('.git-tree-file-row');
        if (!row?.classList?.contains('is-ignored')) {
            this.setStatusLine(`File is not ignored: ${filePath}.`, true);
            return;
        }
        try {
            this.setStatusLine(`Removing ignore rule for ${filePath}...`);
            const payloadText = await this.service.gitCheckIgnore(repoPath, [filePath]);
            const payload = parseJsonToolResult(payloadText) || {};
            const matches = Array.isArray(payload.matches) ? payload.matches : [];
            if (!matches.length) {
                this.setStatusLine(`No ignore rule found for ${filePath}.`, true);
                return;
            }
            const normalizedRepo = normalizeSlashes(repoPath).replace(/\/+$/g, '');
            const updates = new Map();
            const blocked = new Set();
            for (const match of matches) {
                const sourceRaw = String(match?.source || '').trim();
                if (!sourceRaw) continue;
                const normalizedSource = normalizeSlashes(sourceRaw);
                const sourcePath = normalizedSource.startsWith('/') || /^[A-Za-z]:/.test(normalizedSource)
                    ? normalizedSource
                    : normalizeSlashes(joinPath(normalizedRepo, normalizedSource));
                if (!sourcePath.startsWith(`${normalizedRepo}/`) && sourcePath !== normalizedRepo) {
                    blocked.add(sourceRaw);
                    continue;
                }
                const entry = updates.get(sourcePath) || { lines: new Set(), patterns: new Set() };
                if (Number.isFinite(match?.line)) entry.lines.add(match.line);
                if (match?.pattern) entry.patterns.add(String(match.pattern));
                updates.set(sourcePath, entry);
            }
            if (updates.size === 0) {
                this.setStatusLine('Ignore rule is outside this repo. Update global ignore config manually.', true);
                return;
            }
            let changedFiles = 0;
            for (const [sourcePath, entry] of updates.entries()) {
                const content = await this.service.readTextFile(sourcePath);
                const lines = String(content ?? '').split(/\r?\n/);
                const removeIndexes = new Set();
                for (const lineNo of entry.lines) {
                    const idx = Number(lineNo) - 1;
                    if (idx >= 0 && idx < lines.length) removeIndexes.add(idx);
                }
                if (removeIndexes.size === 0 && entry.patterns.size) {
                    const patterns = Array.from(entry.patterns.values());
                    lines.forEach((line, idx) => {
                        const trimmed = line.trim();
                        if (patterns.includes(trimmed)) removeIndexes.add(idx);
                    });
                }
                if (removeIndexes.size === 0) continue;
                const nextLines = lines.filter((_, idx) => !removeIndexes.has(idx));
                let nextContent = nextLines.join('\n');
                if (content && content.endsWith('\n')) {
                    nextContent = `${nextContent}\n`;
                } else if (nextContent && !nextContent.endsWith('\n')) {
                    nextContent = `${nextContent}\n`;
                }
                await this.service.writeFile(sourcePath, nextContent);
                changedFiles += 1;
            }
            if (!changedFiles) {
                this.setStatusLine(`No matching .gitignore entry removed for ${filePath}.`, true);
                return;
            }
            await this.refreshAll({ force: true });
            if (blocked.size) {
                this.setStatusLine(`Removed ignore rule for ${filePath}. Some rules are in global ignores.`, true);
                return;
            }
            this.setStatusLine(`Removed ignore rule for ${filePath}.`);
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        }
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

    async rollbackFile(element) {
        const repoPath = element?.dataset?.repoPath || null;
        const filePath = element?.dataset?.filePath;
        if (!repoPath || !filePath) return;
        this.closeFileMenus();
        const row = element?.closest?.('.git-tree-file-row');
        if (row?.classList?.contains('is-untracked') || row?.classList?.contains('is-ignored')) {
            this.setStatusLine(`Cannot rollback untracked file: ${filePath}.`, true);
            return;
        }
        try {
            this.setStatusLine(`Rolling back ${filePath}...`);
            await this.service.gitRestore(repoPath, [filePath]);
            await this.refreshAll({ force: true });
            this.setStatusLine(`Rolled back ${filePath}.`);
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

    closeFileMenus() {
        this.ui.closeFileMenus();
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

    async applyRepoPathFromInput(value) {
        const next = String(value || '').trim();
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

    async toggleCredentials() {
        const opening = !this.state.credentialsOpen;
        if (opening && !this.state.credentialsGate) {
            await this.prefillCredentialsPanel();
        }
        return this.ui.toggleCredentials();
    }

    closeCredentials() {
        return this.ui.closeCredentials();
    }

    runGitAction(element, mode) {
        return this.actions.runGitAction(element, mode);
    }

    normalizeConflictDetail(detailOrElement, sourceOverride = null) {
        if (detailOrElement instanceof HTMLElement) {
            const repoPath = detailOrElement.dataset.repoPath || '';
            const filePath = detailOrElement.dataset.filePath || '';
            const source = sourceOverride || detailOrElement.dataset.source || '';
            return { repoPath, filePath, source };
        }
        if (detailOrElement && typeof detailOrElement === 'object') {
            if (sourceOverride) {
                return { ...detailOrElement, source: sourceOverride };
            }
            return detailOrElement;
        }
        return sourceOverride ? { source: sourceOverride } : {};
    }

    selectConflictFile(detailOrElement) {
        const detail = this.normalizeConflictDetail(detailOrElement);
        return this.actions.selectConflictFile(detail);
    }

    applyConflictChoice(detailOrElement, sourceOverride) {
        const detail = this.normalizeConflictDetail(detailOrElement, sourceOverride);
        return this.actions.applyConflictChoice(detail);
    }

    stageConflictFile(detailOrElement) {
        const detail = this.normalizeConflictDetail(detailOrElement);
        return this.actions.stageConflictFile(detail);
    }

    refreshConflicts() {
        return this.actions.refreshConflicts();
    }

    cancelConflictResolution() {
        this.state.conflictFocus = false;
        this.syncStaticUI();
    }

    hasAnyConflicts() {
        const manual = Array.isArray(this.state.manualConflicts) ? this.state.manualConflicts : [];
        if (manual.length) return true;
        const repos = Array.isArray(this.state.repoOverviews) ? this.state.repoOverviews : [];
        return repos.some((repo) => {
            const changes = repo?.changes || {};
            const counts = repo?.counts || {};
            const conflicted = Array.isArray(changes.conflicted) ? changes.conflicted.length : 0;
            return conflicted > 0 || Boolean(counts.conflicted);
        });
    }

    async openConflictHelper() {
        const hadConflicts = this.hasAnyConflicts();
        const priorStatus = {
            text: this.state.lastStatusLine,
            isError: this.state.lastStatusIsError
        };
        this.state.conflictFocus = true;
        if (!hadConflicts && typeof this.actions.refreshConflicts === 'function') {
            try {
                await this.actions.refreshConflicts();
            } finally {
                this.state.lastStatusLine = priorStatus.text;
                this.state.lastStatusIsError = priorStatus.isError;
                this.ui.updateStatusBar?.();
            }
        }
        this.syncStaticUI();
    }

    setStatusLine(text, isError = false) {
        this.state.lastStatusLine = text || '';
        this.state.lastStatusIsError = Boolean(isError);
        this.ui.updateStatusBar?.();
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
        const result = await this.repo.refreshAll({ force });
        this.syncStaticUI();
        return result;
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
        this.diff.clearSelectedDiff();
        this.ui.updateRepoTree?.();
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

    async saveGitCredentials(payload = {}) {
        return this.actions.saveGitCredentials(payload);
    }

    cancelGitCredentials() {
        return this.actions.cancelGitCredentials();
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
        await this.diff.selectFile(filePath, section, repoPath);
        this.ui.updateRepoTree?.();
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
