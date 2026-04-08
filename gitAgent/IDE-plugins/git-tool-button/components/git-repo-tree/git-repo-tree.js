import { formatRepoSummary, renderRepoChangesTree as renderRepoChangesTreeInternal } from "../git-commit-modal/git-commit-modal-tree.js";
import {
    peekSelectionEntry,
    isPathSelected,
    getCoveringPrefix,
    getAncestorCoveringPrefix
} from "../git-commit-modal/git-commit-modal-selection.js";

const formatCountLabel = (count, singular, plural = `${singular}s`) => {
    const normalized = Number(count) || 0;
    return `${normalized} ${normalized === 1 ? singular : plural}`;
};

const formatRepoTreeCounts = (counts = {}, { stashCount = 0, cleanLabel = 'Clean' } = {}) => {
    const parts = [];

    if (counts.staged) parts.push(formatCountLabel(counts.staged, 'staged file'));
    if (counts.unstaged) parts.push(formatCountLabel(counts.unstaged, 'changed file'));
    if (counts.untracked) parts.push(formatCountLabel(counts.untracked, 'new file'));
    if (counts.conflicted) parts.push(formatCountLabel(counts.conflicted, 'conflict'));
    if (stashCount) parts.push(formatCountLabel(stashCount, 'stash'));

    return parts.length ? parts.join(', ') : cleanLabel;
};

const isCommittableChangeRow = (row) => {
    if (!row || typeof row === 'string') return true;
    const flags = row.flags || {};
    if (flags.ignored && !flags.staged && !flags.unstaged && !flags.untracked && !flags.conflicted) return false;
    return Boolean(flags.staged || flags.unstaged || flags.untracked || flags.conflicted);
};

const getCommittablePaths = (repo) => {
    const rows = Array.isArray(repo?.changesAll) ? repo.changesAll : [];
    return rows
        .filter((row) => isCommittableChangeRow(row))
        .map((row) => (typeof row === 'string' ? row : String(row?.path || '')))
        .filter(Boolean);
};

export class GitRepoTree {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            reposRoot: '',
            repos: [],
            loading: false,
            repoFilterQuery: '',
            repoTreeExpanded: {},
            repoChangesExpanded: {},
            treeExpandedByRepo: {},
            selectionState: {},
            selectedPath: '',
            selectedRepoPath: ''
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.list = this.element.querySelector('.git-repo-tree-list');
        this.filterInput = this.element.querySelector('#gitRepoFilterInput');
        this.toggleAllInput = this.element.querySelector('#gitRepoToggleAllInput');
        this.toggleAllLabel = this.element.querySelector('#gitRepoToggleAllLabel');
        this.attachDelegatedListeners();
        this.syncFilterInput();
        this.render();
    }

    afterUnload() {
        this.detachDelegatedListeners();
    }

    onKeydown(event) {
        const key = event.key;
        if (key !== 'Enter' && key !== ' ') return;
        const target = event.target?.closest?.(
            '.git-tree-file[data-local-action="openDiff"], ' +
            '.git-file-menu-item[data-local-action]'
        );
        if (!target) return;
        event.preventDefault();
        if (target.classList.contains('git-file-menu-item')) {
            target.click();
            return;
        }
        this.openDiff(target);
    }

    onInput(event) {
        const target = event?.target;
        if (target?.id === 'gitRepoFilterInput') {
            this.handleFilterInput(event);
        }
    }

    onChange(event) {
        const target = event?.target;
        if (target === this.toggleAllInput || target?.id === 'gitRepoToggleAllInput') {
            this.handleToggleAllInputChange(event);
        }
    }

    attachDelegatedListeners() {
        if (!this.delegatedListenersAttached) {
            this.handleDelegatedKeydown = (event) => this.onKeydown(event);
            this.handleDelegatedInput = (event) => this.onInput(event);
            this.handleDelegatedChange = (event) => this.onChange(event);
            this.element.addEventListener('keydown', this.handleDelegatedKeydown);
            this.element.addEventListener('input', this.handleDelegatedInput);
            this.delegatedListenersAttached = true;
        }
        if (this.boundToggleAllInput && this.boundToggleAllInput !== this.toggleAllInput) {
            this.boundToggleAllInput.removeEventListener('change', this.handleDelegatedChange);
            this.boundToggleAllInput = null;
        }
        if (this.toggleAllInput && this.boundToggleAllInput !== this.toggleAllInput) {
            this.toggleAllInput.addEventListener('change', this.handleDelegatedChange);
            this.boundToggleAllInput = this.toggleAllInput;
        }
    }

    detachDelegatedListeners() {
        if (!this.delegatedListenersAttached) return;
        this.element.removeEventListener('keydown', this.handleDelegatedKeydown);
        this.element.removeEventListener('input', this.handleDelegatedInput);
        if (this.boundToggleAllInput) {
            this.boundToggleAllInput.removeEventListener('change', this.handleDelegatedChange);
        }
        this.handleDelegatedKeydown = null;
        this.handleDelegatedInput = null;
        this.handleDelegatedChange = null;
        this.boundToggleAllInput = null;
        this.delegatedListenersAttached = false;
    }

    setState(next = {}) {
        this.applyState(next);
    }

    applyState(next = {}) {
        if (!next || typeof next !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(next, 'reposRoot')) {
            this.state.reposRoot = String(next.reposRoot || '');
        }
        if (Array.isArray(next.repos)) {
            this.state.repos = next.repos;
        }
        if (Object.prototype.hasOwnProperty.call(next, 'loading')) {
            this.state.loading = Boolean(next.loading);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'repoFilterQuery')) {
            this.state.repoFilterQuery = String(next.repoFilterQuery || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'repoTreeExpanded')) {
            this.state.repoTreeExpanded = next.repoTreeExpanded || {};
        }
        if (Object.prototype.hasOwnProperty.call(next, 'repoChangesExpanded')) {
            this.state.repoChangesExpanded = next.repoChangesExpanded || {};
        }
        if (Object.prototype.hasOwnProperty.call(next, 'treeExpandedByRepo')) {
            this.state.treeExpandedByRepo = next.treeExpandedByRepo || {};
        }
        if (Object.prototype.hasOwnProperty.call(next, 'selectionState')) {
            this.state.selectionState = next.selectionState || {};
        }
        if (Object.prototype.hasOwnProperty.call(next, 'selectedPath')) {
            this.state.selectedPath = String(next.selectedPath || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'selectedRepoPath')) {
            this.state.selectedRepoPath = String(next.selectedRepoPath || '');
        }
        this.syncFilterInput();
        this.render();
    }

    syncFilterInput() {
        if (this.filterInput && this.filterInput.value !== this.state.repoFilterQuery) {
            this.filterInput.value = this.state.repoFilterQuery;
        }
    }

    handleFilterInput(event) {
        const value = String(event?.target?.value || '');
        if (value === this.state.repoFilterQuery) return;
        this.state.repoFilterQuery = value;
        this.render();
    }

    toggleRepoFolderExpanded(element) {
        this.getParentPresenter()?.toggleRepoFolderExpanded?.(element);
    }

    toggleRepoChanges(element) {
        this.getParentPresenter()?.toggleRepoChanges?.(element);
    }

    toggleRepoAllChangesCheckbox(element) {
        this.getParentPresenter()?.toggleRepoAllChangesCheckbox?.(element);
    }

    handleToggleAllInputChange(event) {
        this.toggleAllReposCheckbox(event?.target || this.toggleAllInput);
    }

    toggleAllReposCheckbox(element) {
        const repoPaths = this.getDisplayedRepoOverviews()
            .filter((repo) => getCommittablePaths(repo).length > 0)
            .map((repo) => String(repo?.path || '').trim())
            .filter(Boolean);
        if (!repoPaths.length) return;
        const action = element?.dataset?.bulkAction === 'uncheck' ? 'uncheck' : 'check';
        const shouldSelect = action === 'check';
        this.getParentPresenter()?.toggleMultipleReposAllChanges?.(repoPaths, shouldSelect);
    }

    toggleTreeFolder(element) {
        this.getParentPresenter()?.toggleTreeFolder?.(element);
    }

    toggleTreePrefixSelectionCheckbox(element) {
        this.getParentPresenter()?.toggleTreePrefixSelectionCheckbox?.(element);
    }

    toggleTreeFileSelectionCheckbox(element) {
        this.getParentPresenter()?.toggleTreeFileSelectionCheckbox?.(element);
    }

    openDiff(element) {
        this.getParentPresenter()?.openDiff?.(element);
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

    openIgnoreForFile(element) {
        this.getParentPresenter()?.openIgnoreForFile?.(element);
    }

    openIgnoreForFolder(element) {
        this.getParentPresenter()?.openIgnoreForFolder?.(element);
    }

    openStopTrackingForFile(element) {
        this.getParentPresenter()?.openStopTrackingForFile?.(element);
    }

    removeIgnoreForFile(element) {
        this.getParentPresenter()?.removeIgnoreForFile?.(element);
    }

    rollbackFile(element) {
        this.getParentPresenter()?.rollbackFile?.(element);
    }

    deleteFile(element) {
        this.getParentPresenter()?.deleteFile?.(element);
    }

    getParentPresenter() {
        return this.element.closest('git-commit-modal')?.webSkelPresenter || null;
    }

    getSelectionEntry(repoPath) {
        return peekSelectionEntry(this.state.selectionState, repoPath);
    }

    findRepoOverview(repoPath) {
        const repos = Array.isArray(this.state.repos) ? this.state.repos : [];
        return repos.find((repo) => repo?.path === repoPath) || null;
    }

    isFileSelected(repoPath, filePath) {
        const entry = this.getSelectionEntry(repoPath);
        return isPathSelected(entry, filePath);
    }

    getCoveringPrefix(repoPath, prefix) {
        const entry = this.getSelectionEntry(repoPath);
        return getCoveringPrefix(entry, prefix);
    }

    getAncestorCoveringPrefix(repoPath, prefix) {
        const entry = this.getSelectionEntry(repoPath);
        return getAncestorCoveringPrefix(entry, prefix);
    }

    isRepoChangesExpanded(repoPath) {
        if (!repoPath) return true;
        const current = this.state.repoChangesExpanded?.[repoPath];
        if (current !== undefined) {
            return Boolean(current);
        }
        const repo = this.findRepoOverview(repoPath);
        const counts = repo?.counts || {};
        return Boolean(repo?.dirty || counts.staged || counts.unstaged || counts.untracked || counts.conflicted);
    }

    isTreeFolderExpanded(repoPath, prefix) {
        if (!repoPath || !prefix) return true;
        const key = `${repoPath}::${prefix}`;
        const current = this.state.treeExpandedByRepo?.[key];
        return current === undefined ? undefined : Boolean(current);
    }

    getDisplayedRepoOverviews() {
        const repos = Array.isArray(this.state.repos) ? this.state.repos : [];
        const needle = String(this.state.repoFilterQuery || '').trim().toLowerCase();
        if (!needle) return repos;
        return repos.filter((repo) => {
            const haystacks = [
                repo?.name,
                repo?.relativePath,
                repo?.path,
                repo?.branch
            ].map((value) => String(value || '').toLowerCase());
            return haystacks.some((value) => value.includes(needle));
        });
    }

    getRepoCheckboxState(repo) {
        const changedPaths = getCommittablePaths(repo);
        const entry = this.getSelectionEntry(repo?.path);
        const repoSelected = Boolean(entry?.prefixes?.has?.('*'));
        const selectedCount = changedPaths.reduce((acc, filePath) => acc + (this.isFileSelected(repo?.path, filePath) ? 1 : 0), 0);
        const any = selectedCount > 0;
        return {
            checked: repoSelected || (changedPaths.length > 0 && selectedCount === changedPaths.length),
            indeterminate: !repoSelected && any && selectedCount < changedPaths.length
        };
    }

    syncToggleAllState(repos = []) {
        if (!this.toggleAllInput) return;
        const list = Array.isArray(repos) ? repos.filter((repo) => String(repo?.path || '').trim()) : [];
        if (!list.length) {
            this.toggleAllInput.checked = false;
            this.toggleAllInput.indeterminate = false;
            this.toggleAllInput.disabled = true;
            this.toggleAllInput.removeAttribute('checked');
            this.toggleAllInput.dataset.bulkAction = 'check';
            if (this.toggleAllLabel) this.toggleAllLabel.textContent = 'Check all repos';
            return;
        }

        let checkedCount = 0;
        let hasIndeterminate = false;
        for (const repo of list) {
            const state = this.getRepoCheckboxState(repo);
            if (state.checked) checkedCount += 1;
            if (state.indeterminate) hasIndeterminate = true;
        }

        const shouldUncheck = checkedCount > 0 || hasIndeterminate;
        this.toggleAllInput.disabled = false;
        this.toggleAllInput.checked = shouldUncheck;
        this.toggleAllInput.indeterminate = false;
        if (shouldUncheck) {
            this.toggleAllInput.setAttribute('checked', '');
        } else {
            this.toggleAllInput.removeAttribute('checked');
        }
        this.toggleAllInput.dataset.bulkAction = shouldUncheck ? 'uncheck' : 'check';
        if (this.toggleAllLabel) {
            this.toggleAllLabel.textContent = shouldUncheck ? 'Uncheck all repos' : 'Check all repos';
        }
    }

    buildRepoTree(repos) {
        const root = {
            id: '/',
            name: this.state.reposRoot,
            children: new Map(),
            repos: [],
            counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, stashed: 0 }
        };

        const addCounts = (target, counts) => {
            const c = counts || {};
            target.counts.staged += c.staged || 0;
            target.counts.unstaged += c.unstaged || 0;
            target.counts.untracked += c.untracked || 0;
            target.counts.conflicted += c.conflicted || 0;
            target.counts.stashed += c.stashed || 0;
        };

        for (const repo of repos) {
            const rel = String(repo.relativePath || repo.name || '').replace(/^\/+/, '');
            const parts = rel.split('/').filter(Boolean);
            let node = root;
            for (let i = 0; i < Math.max(0, parts.length - 1); i += 1) {
                const part = parts[i];
                const nextId = node.id === '/' ? part : `${node.id}/${part}`;
                if (!node.children.has(part)) {
                    node.children.set(part, {
                        id: nextId,
                        name: part,
                        children: new Map(),
                        repos: [],
                        counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, stashed: 0 }
                    });
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

    renderRepoChangesTree(repo) {
        return renderRepoChangesTreeInternal(repo, {
            isFileSelected: (repoPath, filePath) => this.isFileSelected(repoPath, filePath),
            getAncestorCoveringPrefix: (repoPath, prefix) => this.getAncestorCoveringPrefix(repoPath, prefix),
            getCoveringPrefix: (repoPath, prefix) => this.getCoveringPrefix(repoPath, prefix),
            isFolderExpanded: (repoPath, prefix) => this.isTreeFolderExpanded(repoPath, prefix)
        });
    }

    applyActiveStyles(root, activePath, activeRepo) {
        if (!root || !activePath) return;
        const items = root.querySelectorAll('.git-tree-file');
        items.forEach((el) => {
            const matches = Boolean(
                activePath
                && el.dataset.filePath === activePath
                && (!activeRepo || el.dataset.repoPath === activeRepo)
            );
            el.classList.toggle('active', matches);
            el.closest?.('.git-tree-file-row')?.classList.toggle('active', matches);
        });
    }

    render() {
        if (!this.list) return;
        this.list.innerHTML = '';

        const items = Array.isArray(this.state.repos) ? this.state.repos : [];
        if (this.state.loading && items.length === 0) {
            this.syncToggleAllState([]);
            const loading = document.createElement('div');
            loading.className = 'git-empty';
            loading.textContent = 'Loading repositories…';
            this.list.appendChild(loading);
            return;
        }

        if (items.length === 0) {
            this.syncToggleAllState([]);
            const empty = document.createElement('div');
            empty.className = 'git-empty';
            empty.textContent = `No repositories found under ${this.state.reposRoot}.`;
            this.list.appendChild(empty);
            return;
        }

        const repos = this.getDisplayedRepoOverviews();
        if (repos.length === 0) {
            this.syncToggleAllState([]);
            const empty = document.createElement('div');
            empty.className = 'git-empty';
            empty.textContent = 'No repositories match this filter.';
            this.list.appendChild(empty);
            return;
        }
        this.syncToggleAllState(repos);
        const tree = this.buildRepoTree(repos);
        const expandedMap = this.state.repoTreeExpanded || {};

        const activePath = this.state.selectedPath || '';
        const activeRepo = this.state.selectedRepoPath || '';

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
            const summary = formatRepoTreeCounts(node.counts, {
                stashCount: node.counts.stashed,
                cleanLabel: 'No changes'
            });
            label.textContent = `${folderId === '/' ? this.state.reposRoot : node.name} · ${summary}`;

            left.appendChild(expandBtn);
            left.appendChild(label);

            row.appendChild(left);
            wrapper.appendChild(row);

            if (!isExpanded) {
                this.list.appendChild(wrapper);
                return;
            }

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
                const repoCheckboxState = this.getRepoCheckboxState(repo);
                repoCheckbox.checked = repoCheckboxState.checked;
                repoCheckbox.indeterminate = repoCheckboxState.indeterminate;
                repoCheckbox.disabled = getCommittablePaths(repo).length === 0;

                const changesToggle = document.createElement('button');
                changesToggle.type = 'button';
                changesToggle.className = 'secondary git-tree-collapse';
                changesToggle.dataset.repoPath = repo.path;
                changesToggle.setAttribute('data-local-action', 'toggleRepoChanges');
                const repoExpanded = this.isRepoChangesExpanded(repo.path);
                changesToggle.textContent = repoExpanded ? '▾' : '▸';

                const counts = repo.counts || { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
                const label = document.createElement('div');
                label.className = 'git-change-button';
                label.textContent = `${repo.name}${repo.branch ? ` · ${repo.branch}` : ''}`;
                repoLeft.appendChild(changesToggle);
                repoLeft.appendChild(repoCheckbox);
                repoLeft.appendChild(label);

                const info = document.createElement('div');
                info.className = 'git-info-button';
                info.setAttribute('role', 'button');
                info.setAttribute('tabindex', '0');
                const summary = formatRepoSummary(repo);
                info.dataset.tooltip = summary;
                info.setAttribute('aria-label', summary);
                info.textContent = 'i';
                repoLeft.appendChild(info);
                repoRow.appendChild(repoLeft);

                repoWrapper.appendChild(repoRow);

                const ignoredCount = Number.isFinite(repo?.ignoredCount)
                    ? repo.ignoredCount
                    : (Array.isArray(repo?.ignored) ? repo.ignored.length : 0);
                const hasChanges = Boolean(
                    repo?.dirty
                    || counts.staged
                    || counts.unstaged
                    || counts.untracked
                    || counts.conflicted
                    || ignoredCount
                );
                if (hasChanges && this.isRepoChangesExpanded(repo.path)) {
                    const changesTree = this.renderRepoChangesTree(repo);
                    if (changesTree) {
                        this.applyActiveStyles(changesTree, activePath, activeRepo);
                        repoWrapper.appendChild(changesTree);
                    }
                }

                wrapper.appendChild(repoWrapper);
            }

            const childNames = Array.from(node.children.keys()).sort((a, b) => a.localeCompare(b));
            for (const childName of childNames) {
                renderFolder(node.children.get(childName), depth + 1);
            }

            this.list.appendChild(wrapper);
        };

        renderFolder(tree, 0);
    }
}
