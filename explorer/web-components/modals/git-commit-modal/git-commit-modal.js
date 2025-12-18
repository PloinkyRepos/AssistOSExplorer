import { parseDetailedDirectoryListing, joinPath } from "../../pages/file-exp/file-exp-utils.js";
import { normalizeErrorMessage, parseJsonToolResult, isReposRootPath } from "./git-commit-modal-utils.js";
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

export class GitCommitModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.statusCache = { at: 0, payload: null };
        this.diffCache = new Map();
        this.repoOverviewCache = { at: 0, list: [] };
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
            selectedRepoPaths: [],
            repoTreeExpanded: {},
            showCleanRepos: false,
            selectedFilesByRepo: {},
            selectedRepoPath: null,
            status: {
                staged: [],
                unstaged: [],
                untracked: [],
                conflicted: []
            },
            selectedPath: null,
            selectedSection: null, // 'staged' | 'unstaged' | 'untracked' | 'conflicted'
            diffText: '',
            diffLoading: false,
            busy: false,
            commitMessage: '',
            amend: false,
            signoff: false,
            pushAfterCommit: false,
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
        // On open: force-load repos overview so the user immediately sees changes across all repos.
        this.refreshAll({ force: true });
    }

    bindEvents() {
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

        const showCleanToggle = this.element.querySelector('#gitShowCleanRepos');
        if (showCleanToggle && !showCleanToggle.dataset.bound) {
            showCleanToggle.addEventListener('change', (event) => {
                this.state.showCleanRepos = Boolean(event.target.checked);
                this.renderRepoOverviews(this.state.repoOverviews);
            });
            showCleanToggle.dataset.bound = 'true';
        }

        const commitMessage = this.element.querySelector('#gitCommitMessage');
        if (commitMessage && !commitMessage.dataset.bound) {
            commitMessage.addEventListener('input', (event) => {
                this.state.commitMessage = event.target.value || '';
                this.updateCommitButtons();
            });
            commitMessage.dataset.bound = 'true';
        }

        const amendInput = this.element.querySelector('#gitCommitAmend');
        if (amendInput && !amendInput.dataset.bound) {
            amendInput.addEventListener('change', (event) => {
                this.state.amend = Boolean(event.target.checked);
                this.updateCommitButtons();
            });
            amendInput.dataset.bound = 'true';
        }

        const signoffInput = this.element.querySelector('#gitCommitSignoff');
        if (signoffInput && !signoffInput.dataset.bound) {
            signoffInput.addEventListener('change', (event) => {
                this.state.signoff = Boolean(event.target.checked);
            });
            signoffInput.dataset.bound = 'true';
        }

        const pushAfterCommitInput = this.element.querySelector('#gitPushAfterCommit');
        if (pushAfterCommitInput && !pushAfterCommitInput.dataset.bound) {
            pushAfterCommitInput.addEventListener('change', (event) => {
                this.state.pushAfterCommit = Boolean(event.target.checked);
                this.updateCommitButtons();
            });
            pushAfterCommitInput.dataset.bound = 'true';
        }

        const changesRoot = this.element.querySelector('.git-changes');
        if (changesRoot && !changesRoot.dataset.bound) {
            changesRoot.addEventListener('click', (event) => {
                const repoToggle = event.target.closest('input[data-repo-select="true"]');
                if (repoToggle) {
                    const repoPath = repoToggle.dataset.repoPath;
                    this.toggleRepoSelection(repoPath, Boolean(repoToggle.checked));
                    return;
                }
                const folderToggle = event.target.closest('input[data-folder-select="true"]');
                if (folderToggle) {
                    const folderId = folderToggle.dataset.folderId;
                    this.toggleFolderSelection(folderId, Boolean(folderToggle.checked));
                    return;
                }
                const fileToggle = event.target.closest('input[data-file-select="true"]');
                if (fileToggle) {
                    const repoPath = fileToggle.dataset.repoPath;
                    const filePath = fileToggle.dataset.filePath;
                    const section = fileToggle.dataset.section;
                    this.toggleFileSelection(repoPath, filePath, section, Boolean(fileToggle.checked));
                    return;
                }
                const folderFileToggle = event.target.closest('input[data-file-folder-select="true"]');
                if (folderFileToggle) {
                    const repoPath = folderFileToggle.dataset.repoPath;
                    const prefix = folderFileToggle.dataset.prefix || '';
                    this.togglePrefixSelection(repoPath, prefix, Boolean(folderFileToggle.checked));
                    return;
                }
            });
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

    pushAction() {
        this.push({ silent: false });
    }

    openRepo(element) {
        const repoPath = element?.dataset?.repoPath;
        if (!repoPath) return;
        const input = this.element.querySelector('#gitRepoPathInput');
        if (input) input.value = repoPath;
        this.applyRepoPathFromInput();
    }

    openDiff(element) {
        const repoPath = element?.dataset?.repoPath || null;
        const filePath = element?.dataset?.filePath;
        const section = element?.dataset?.section || null;
        if (!filePath) return;
        this.selectFile(filePath, section, repoPath);
    }

    stageEntry(element) {
        const filePath = element?.dataset?.filePath;
        if (!filePath) return;
        this.stageFiles([filePath]);
    }

    unstageEntry(element) {
        const filePath = element?.dataset?.filePath;
        if (!filePath) return;
        this.unstageFiles([filePath]);
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
        const showCleanToggle = this.element.querySelector('#gitShowCleanRepos');
        if (showCleanToggle) {
            showCleanToggle.checked = Boolean(this.state.showCleanRepos);
        }
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
        this.syncStaticUI();
        await this.refreshAll({ force: true });
    }

    setBusy(isBusy) {
        this.state.busy = Boolean(isBusy);
        const root = this.element.querySelector('.git-modal');
        if (root) {
            root.classList.toggle('busy', this.state.busy);
        }
        this.updateCommitButtons();
    }

    setStatusLine(text, isError = false) {
        this.state.lastStatusLine = text || '';
        const status = this.element.querySelector('#gitStatusLine');
        if (!status) return;
        status.textContent = this.state.lastStatusLine;
        status.classList.toggle('error', Boolean(isError));
    }

    async callTool(name, args) {
        const result = await window.webSkel.appServices.callTool('explorer', name, args);
        if (result?.text?.startsWith?.('Error:')) {
            throw new Error(result.text);
        }
        return result?.text ?? '';
    }

    async refreshAll({ force = false } = {}) {
        this.setStatusLine('Loading git status…');
        try {
            await this.loadRepoOverviews({ force });

            // Multi-repo view: don't call git_info/git_status on the repos root.
            if (isReposRootPath(this.state.repoPath, this.state.reposRoot)) {
                this.state.repoInfoOk = false;
                this.state.branch = null;
                this.state.upstream = null;
                this.state.remotes = [];
                this.state.selectedRepoPath = null;
                this.state.status = { staged: [], unstaged: [], untracked: [], conflicted: [] };
                this.renderStatusLists();
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
                this.state.status = { staged: [], unstaged: [], untracked: [], conflicted: [] };
                this.renderStatusLists();
                this.updateCommitButtons();
                this.setStatusLine('Select a repository from the list.');
                return;
            }
            await this.loadStatus({ force });
            this.renderStatusLists();
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

    toggleRepoSelection(repoPath, isSelected) {
        if (!repoPath) return;
        const set = new Set(this.state.selectedRepoPaths || []);
        if (isSelected) set.add(repoPath);
        else {
            set.delete(repoPath);
            if (this.state.selectedFilesByRepo?.[repoPath]) {
                const next = { ...(this.state.selectedFilesByRepo || {}) };
                delete next[repoPath];
                this.state.selectedFilesByRepo = next;
            }
        }
        this.state.selectedRepoPaths = Array.from(set);
        this.updateCommitButtons();
        this.renderRepoOverviews(this.state.repoOverviews);
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

    toggleFolderSelection(folderId, isSelected) {
        if (!folderId) return;
        const repoPaths = this.getRepoPathsUnderFolder(folderId);
        const set = new Set(this.state.selectedRepoPaths || []);
        repoPaths.forEach((p) => {
            if (isSelected) set.add(p);
            else set.delete(p);
        });
        this.state.selectedRepoPaths = Array.from(set);
        if (!isSelected && this.state.selectedFilesByRepo) {
            const next = { ...(this.state.selectedFilesByRepo || {}) };
            for (const repoPath of repoPaths) {
                delete next[repoPath];
            }
            this.state.selectedFilesByRepo = next;
        }
        this.renderRepoOverviews(this.state.repoOverviews);
        this.updateCommitButtons();
    }

    getDisplayedRepoOverviews() {
        const repos = Array.isArray(this.state.repoOverviews) ? this.state.repoOverviews : [];
        if (this.state.showCleanRepos) return repos;
        return repos.filter((repo) => {
            if (!repo) return false;
            const counts = repo.counts || {};
            return Boolean(repo.dirty || counts.staged || counts.unstaged || counts.untracked || counts.conflicted);
        });
    }

    getRepoPathsUnderFolder(folderId) {
        const prefix = folderId === '/' ? '' : folderId.replace(/\/+$/g, '') + '/';
        const repos = this.getDisplayedRepoOverviews();
        return repos
            .filter((r) => r && (r.relativePath || r.name))
            .filter((r) => {
                const rel = String(r.relativePath || r.name);
                if (!prefix) return true;
                return rel.startsWith(prefix);
            })
            .map((r) => r.path)
            .filter(Boolean);
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

    computeFolderSelectionState(folderId, repoPaths, selectedSet) {
        const total = repoPaths.length;
        const selected = repoPaths.reduce((acc, p) => acc + (selectedSet.has(p) ? 1 : 0), 0);
        return { total, selected, all: total > 0 && selected === total, none: selected === 0, partial: selected > 0 && selected < total };
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

        if (!this.state.showCleanRepos) {
            const dirty = this.getDisplayedRepoOverviews();
            if (dirty.length === 0 && !this.state.repoOverviewsLoading) {
                const empty = document.createElement('div');
                empty.className = 'git-empty';
                empty.textContent = 'No repositories with changes.';
                container.appendChild(empty);
                return;
            }
        }

        const selected = new Set(this.getSelectedReposForBatch());
        const tree = this.buildRepoTree();
        const expandedMap = this.state.repoTreeExpanded || {};

        const renderFolder = (node, depth = 0) => {
            const folderId = node.id;
            const repoPaths = this.getRepoPathsUnderFolder(folderId);
            const selection = this.computeFolderSelectionState(folderId, repoPaths, selected);

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

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.folderSelect = 'true';
            checkbox.dataset.folderId = folderId;
            checkbox.checked = selection.all;
            checkbox.indeterminate = selection.partial;

            const label = document.createElement('div');
            label.className = 'git-folder-label';
            const badge = `S:${node.counts.staged} U:${node.counts.unstaged} N:${node.counts.untracked}${node.counts.conflicted ? ` C:${node.counts.conflicted}` : ''}`;
            label.textContent = `${folderId === '/' ? this.state.reposRoot : node.name} · ${badge}`;

            left.appendChild(expandBtn);
            left.appendChild(checkbox);
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
                repoCheckbox.dataset.repoSelect = 'true';
                repoCheckbox.dataset.repoPath = repo.path;
                repoCheckbox.checked = selected.has(repo.path);

                const open = document.createElement('button');
                open.type = 'button';
                open.className = 'git-change-button';
                open.dataset.repoPath = repo.path;
                open.setAttribute('data-local-action', 'openRepo');
                const counts = repo.counts || { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
                const repoBadge = repo.ok
                    ? `S:${counts.staged} U:${counts.unstaged} N:${counts.untracked}${counts.conflicted ? ` C:${counts.conflicted}` : ''}`
                    : 'not git';
                open.textContent = `${repo.name} · ${repoBadge}${repo.branch ? ` · ${repo.branch}` : ''}`;

                repoLeft.appendChild(repoCheckbox);
                repoLeft.appendChild(open);

                const openBtn = document.createElement('button');
                openBtn.type = 'button';
                openBtn.className = 'secondary git-change-action';
                openBtn.dataset.repoPath = repo.path;
                openBtn.setAttribute('data-local-action', 'openRepo');
                openBtn.textContent = 'Open';

                repoRow.appendChild(repoLeft);
                repoRow.appendChild(openBtn);
                repoWrapper.appendChild(repoRow);

                const details = document.createElement('div');
                details.className = 'git-repo-changes';
                details.textContent = this.formatRepoSummary(repo);
                repoWrapper.appendChild(details);

	                const hasChanges = Boolean(repo?.dirty || counts.staged || counts.unstaged || counts.untracked || counts.conflicted);
	                if (hasChanges) {
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
            getCoveringPrefix: (repoPath, prefix) => this.getCoveringPrefix(repoPath, prefix)
        });
    }

    async loadStatus({ force = false } = {}) {
        const now = Date.now();
        if (!force && this.statusCache.payload && now - this.statusCache.at < 600) {
            this.state.status = this.statusCache.payload.status;
            return this.state.status;
        }
        const text = await this.callTool('git_status', { path: this.state.repoPath });
        const payload = parseJsonToolResult(text) || {};
        const status = payload.status || payload;
        this.state.status = {
            staged: Array.isArray(status.staged) ? status.staged : [],
            unstaged: Array.isArray(status.unstaged) ? status.unstaged : [],
            untracked: Array.isArray(status.untracked) ? status.untracked : [],
            conflicted: Array.isArray(status.conflicted) ? status.conflicted : []
        };
        this.statusCache = { at: now, payload: { status: this.state.status, repoInfo: this.statusCache.payload?.repoInfo } };
        return this.state.status;
    }

    renderStatusLists() {
        const { staged, unstaged, untracked, conflicted } = this.state.status;
        this.renderList('#gitUnstagedList', unstaged, 'unstaged');
        this.renderList('#gitStagedList', staged, 'staged');
        this.renderList('#gitUntrackedList', untracked, 'untracked');
        this.renderList('#gitConflictedList', conflicted, 'conflicted');
        const conflictsSection = this.element.querySelector('#gitConflictsSection');
        if (conflictsSection) {
            conflictsSection.style.display = conflicted.length ? '' : 'none';
        }
        this.refreshActiveRowStyles();
    }

    renderList(selector, items, section) {
        const container = this.element.querySelector(selector);
        if (!container) return;
        container.innerHTML = '';

        if (!items || !items.length) {
            const empty = document.createElement('div');
            empty.className = 'git-empty';
            empty.textContent = 'No changes.';
            container.appendChild(empty);
            return;
        }

        items.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'git-change-row';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'git-change-button';
            button.setAttribute('data-local-action', 'openDiff');
            button.dataset.repoPath = this.state.repoPath;
            button.dataset.filePath = entry.path;
            button.dataset.section = section;
            button.textContent = entry.path;

            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'secondary git-change-action';
            action.dataset.section = section;
            action.dataset.repoPath = this.state.repoPath;
            action.dataset.filePath = entry.path;

            if (section === 'staged') {
                action.setAttribute('data-local-action', 'unstageEntry');
                action.textContent = 'Unstage';
            } else if (section === 'unstaged' || section === 'untracked') {
                action.setAttribute('data-local-action', 'stageEntry');
                action.textContent = 'Stage';
            } else {
                action.setAttribute('data-local-action', 'openDiff');
                action.textContent = 'View';
            }

            row.appendChild(button);
            row.appendChild(action);
            container.appendChild(row);
        });
    }

    refreshActiveRowStyles() {
        const activePath = this.state.selectedPath;
        const buttons = this.element.querySelectorAll('.git-change-button');
        buttons.forEach((btn) => {
            btn.classList.toggle('active', Boolean(activePath && btn.dataset.filePath === activePath));
        });
    }

    updateCommitButtons() {
        const commitButton = this.element.querySelector('#gitCommitButton');
        const pushButton = this.element.querySelector('#gitPushButton');
        const commitSelectedButton = this.element.querySelector('#gitCommitSelectedButton');
        const pushSelectedButton = this.element.querySelector('#gitPushSelectedButton');
        const hasStaged = (this.state.status?.staged || []).length > 0;
        const messageOk = Boolean((this.state.commitMessage || '').trim()) || this.state.amend;
        const selectedRepos = Array.from(new Set([
            ...(this.state.selectedRepoPaths || []),
            ...Object.entries(this.state.selectedFilesByRepo || {})
                .filter(([, entry]) => (entry?.files && entry.files.size > 0) || (entry?.prefixes && entry.prefixes.size > 0))
                .map(([repoPath]) => repoPath)
        ]));
        const selectedCount = selectedRepos.length;
        const repoOk = this.state.repoInfoOk !== false;
        if (commitButton) {
            commitButton.disabled = this.state.busy || !repoOk || !hasStaged || !messageOk;
            commitButton.textContent = this.state.pushAfterCommit ? 'Commit & Push' : 'Commit';
        }
        if (pushButton) {
            pushButton.disabled = this.state.busy || !repoOk;
        }
        if (commitSelectedButton) {
            commitSelectedButton.style.display = selectedCount ? '' : 'none';
            commitSelectedButton.disabled = this.state.busy || !messageOk;
        }
        if (pushSelectedButton) {
            pushSelectedButton.style.display = selectedCount ? '' : 'none';
            pushSelectedButton.disabled = this.state.busy;
        }
    }

    getSelectedReposForBatch() {
        return Array.from(new Set([
            ...(this.state.selectedRepoPaths || []),
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
        this.setBusy(true);
        this.setStatusLine(`Committing ${selected.length} repo(s)…`);
        try {
            const selectedRepoSet = new Set(this.state.selectedRepoPaths || []);
            for (const repoPath of selected) {
                const selectedEntry = this.state.selectedFilesByRepo?.[repoPath];
                const targets = new Set();
                for (const prefix of selectedEntry?.prefixes || []) targets.add(prefix);
                for (const file of selectedEntry?.files || []) targets.add(file);
                const list = Array.from(targets);

                if (list.length) {
                    await this.callTool('git_stage', { path: repoPath, files: list });
                } else if (selectedRepoSet.has(repoPath)) {
                    await this.callTool('git_stage', { path: repoPath, files: [] });
                } else {
                    continue;
                }
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
                if (this.state.pushAfterCommit) {
                    await this.callTool('git_push', { path: repoPath });
                }
            }
            this.state.selectedRepoPaths = [];
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
        } finally {
            this.setBusy(false);
        }
    }

    async pushSelectedRepos() {
        const selected = this.getSelectedReposForBatch();
        if (!selected.length) return;
        this.setBusy(true);
        this.setStatusLine(`Pushing ${selected.length} repo(s)…`);
        try {
            for (const repoPath of selected) {
                await this.callTool('git_push', { path: repoPath });
            }
            this.state.selectedRepoPaths = [];
            this.state.selectedFilesByRepo = {};
            await this.loadRepoOverviews({ force: true });
            await this.refreshAll({ force: true });
            this.setStatusLine('Pushed.');
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        } finally {
            this.setBusy(false);
        }
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
            const cached = section === 'staged';
            const text = await this.callTool('git_diff', { path: repoPath, file: filePath, cached });
            const diffText = text || '(no diff)';
            this.diffCache.set(cachedKey, diffText);
            this.renderDiff(diffText, { filePath, section });
        } catch (error) {
            const message = normalizeErrorMessage(error);
            this.renderDiff(message, { filePath, section, isError: true });
        }
    }

    renderDiff(text, { filePath, section, loading = false, isError = false } = {}) {
        const title = this.element.querySelector('#gitDiffTitle');
        const meta = this.element.querySelector('#gitDiffMeta');
        const body = this.element.querySelector('#gitDiffBody');
        if (title) title.textContent = 'Diff';
        if (meta) {
            const parts = [];
            if (filePath) parts.push(filePath);
            if (section === 'staged') parts.push('staged');
            if (section === 'unstaged') parts.push('unstaged');
            if (section === 'untracked') parts.push('untracked');
            if (loading) parts.push('loading…');
            meta.textContent = parts.join(' · ');
        }
        if (body) {
            body.textContent = text || '';
            body.classList.toggle('error', Boolean(isError));
        }
    }

    async stageAll() {
        await this.stageFiles([]);
    }

    async unstageAll() {
        await this.unstageFiles([]);
    }

    async stageFiles(files) {
        this.setBusy(true);
        this.setStatusLine('Staging…');
        try {
            await this.callTool('git_stage', { path: this.state.repoPath, files: files || [] });
            this.diffCache.clear();
            await this.loadStatus({ force: true });
            this.renderStatusLists();
            this.setStatusLine('Staged.');
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        } finally {
            this.setBusy(false);
        }
    }

    async unstageFiles(files) {
        this.setBusy(true);
        this.setStatusLine('Unstaging…');
        try {
            await this.callTool('git_unstage', { path: this.state.repoPath, files: files || [] });
            this.diffCache.clear();
            await this.loadStatus({ force: true });
            this.renderStatusLists();
            this.setStatusLine('Unstaged.');
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        } finally {
            this.setBusy(false);
        }
    }

    async commit() {
        const message = (this.state.commitMessage || '').trim();
        if (!this.state.amend && !message) {
            this.setStatusLine('Enter a commit message.', true);
            return;
        }
        this.setBusy(true);
        this.setStatusLine(this.state.pushAfterCommit ? 'Committing & pushing…' : 'Committing…');
        try {
            await this.callTool('git_commit', {
                path: this.state.repoPath,
                message,
                amend: Boolean(this.state.amend),
                signoff: Boolean(this.state.signoff)
            });
            this.state.commitMessage = '';
            const commitMessage = this.element.querySelector('#gitCommitMessage');
            if (commitMessage) commitMessage.value = '';
            this.diffCache.clear();
            await this.loadStatus({ force: true });
            this.renderStatusLists();
            if (this.state.pushAfterCommit) {
                await this.push({ silent: true });
                this.setStatusLine('Committed & pushed.');
            } else {
                this.setStatusLine('Committed.');
            }
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        } finally {
            this.setBusy(false);
        }
    }

    async push({ silent = false } = {}) {
        const alreadyBusy = this.state.busy;
        if (!alreadyBusy) {
            this.setBusy(true);
        }
        if (!silent) {
            this.setStatusLine('Pushing…');
        }
        try {
            await this.callTool('git_push', { path: this.state.repoPath });
            if (!silent) {
                this.setStatusLine('Pushed.');
            }
        } catch (error) {
            this.setStatusLine(normalizeErrorMessage(error), true);
        } finally {
            if (!alreadyBusy) {
                this.setBusy(false);
            }
        }
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
