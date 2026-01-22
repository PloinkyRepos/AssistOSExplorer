import { formatRepoSummary, renderRepoChangesTree as renderRepoChangesTreeInternal } from "../../modals/git-commit-modal/git-commit-modal-tree.js";
import {
    peekSelectionEntry,
    isPathSelected,
    getCoveringPrefix,
    getAncestorCoveringPrefix
} from "../../modals/git-commit-modal/git-commit-modal-selection.js";

export class GitRepoTree {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            reposRoot: '',
            repos: [],
            loading: false,
            repoTreeExpanded: {},
            repoChangesExpanded: {},
            treeExpandedByRepo: {},
            selectionState: {},
            selectedPath: '',
            selectedRepoPath: ''
        };
        this.boundActions = false;
        this.onKeydown = this.onKeydown.bind(this);
        this.onUpdate = this.onUpdate.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.list = this.element.querySelector('.git-repo-tree-list');
        this.bindEvents();
        if (!this.element.dataset.boundRepoTreeUpdate) {
            this.element.addEventListener('git-repo-tree-update', this.onUpdate);
            this.element.dataset.boundRepoTreeUpdate = 'true';
        }
        this.render();
    }

    bindEvents() {
        if (this.boundActions) return;
        this.element.addEventListener('keydown', this.onKeydown);
        this.boundActions = true;
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

    setState(next = {}) {
        this.applyState(next);
    }

    onUpdate(event) {
        this.applyState(event?.detail || {});
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
        this.render();
    }

    emit(name, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }

    emitAction(action, element) {
        this.emit('git-repo-tree-action', { action, element });
    }

    toggleRepoFolderExpanded(element) {
        this.emitAction('toggleRepoFolderExpanded', element);
    }

    toggleRepoChanges(element) {
        this.emitAction('toggleRepoChanges', element);
    }

    toggleRepoAllChangesCheckbox(element) {
        this.emitAction('toggleRepoAllChangesCheckbox', element);
    }

    toggleTreeFolder(element) {
        this.emitAction('toggleTreeFolder', element);
    }

    toggleTreePrefixSelectionCheckbox(element) {
        this.emitAction('toggleTreePrefixSelectionCheckbox', element);
    }

    toggleTreeFileSelectionCheckbox(element) {
        this.emitAction('toggleTreeFileSelectionCheckbox', element);
    }

    openDiff(element) {
        this.emitAction('openDiff', element);
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
        this.emitAction('openIgnoreForFile', element);
    }

    openIgnoreForFolder(element) {
        this.emitAction('openIgnoreForFolder', element);
    }

    openStopTrackingForFile(element) {
        this.emitAction('openStopTrackingForFile', element);
    }

    removeIgnoreForFile(element) {
        this.emitAction('removeIgnoreForFile', element);
    }

    rollbackFile(element) {
        this.emitAction('rollbackFile', element);
    }

    deleteFile(element) {
        this.emitAction('deleteFile', element);
    }

    getSelectionEntry(repoPath) {
        return peekSelectionEntry(this.state.selectionState, repoPath);
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
        return current === undefined ? true : Boolean(current);
    }

    isTreeFolderExpanded(repoPath, prefix) {
        if (!repoPath || !prefix) return true;
        const key = `${repoPath}::${prefix}`;
        const current = this.state.treeExpandedByRepo?.[key];
        return current === undefined ? true : Boolean(current);
    }

    getDisplayedRepoOverviews() {
        return Array.isArray(this.state.repos) ? this.state.repos : [];
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
            const loading = document.createElement('div');
            loading.className = 'git-empty';
            loading.textContent = 'Loading repositories…';
            this.list.appendChild(loading);
            return;
        }

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'git-empty';
            empty.textContent = `No repositories found under ${this.state.reposRoot}.`;
            this.list.appendChild(empty);
            return;
        }

        const repos = this.getDisplayedRepoOverviews();
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
            const stashBadge = node.counts.stashed ? ` · stash:${node.counts.stashed}` : '';
            const badge = `S:${node.counts.staged} U:${node.counts.unstaged} N:${node.counts.untracked}${node.counts.conflicted ? ` C:${node.counts.conflicted}` : ''}${stashBadge}`;
            label.textContent = `${folderId === '/' ? this.state.reposRoot : node.name} · ${badge}`;

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
                const changedPaths = Array.isArray(repo?.changesAll)
                    ? repo.changesAll.map((c) => (typeof c === 'string' ? c : String(c?.path || ''))).filter(Boolean)
                    : [];
                const entry = this.getSelectionEntry(repo.path);
                const repoSelected = Boolean(entry?.prefixes?.has?.('*'));
                const selectedCount = changedPaths.reduce((acc, p) => acc + (this.isFileSelected(repo.path, p) ? 1 : 0), 0);
                const any = selectedCount > 0;
                repoCheckbox.checked = repoSelected || (changedPaths.length > 0 && selectedCount === changedPaths.length);
                repoCheckbox.indeterminate = !repoSelected && any && selectedCount < changedPaths.length;

                const changesToggle = document.createElement('button');
                changesToggle.type = 'button';
                changesToggle.className = 'secondary git-tree-collapse';
                changesToggle.dataset.repoPath = repo.path;
                changesToggle.setAttribute('data-local-action', 'toggleRepoChanges');
                const repoExpanded = this.isRepoChangesExpanded(repo.path);
                changesToggle.textContent = repoExpanded ? '▾' : '▸';

                const counts = repo.counts || { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
                const stashCount = Number.isFinite(repo.stashCount) ? repo.stashCount : 0;
                const repoBadge = repo.ok
                    ? `S:${counts.staged} U:${counts.unstaged} N:${counts.untracked}${counts.conflicted ? ` C:${counts.conflicted}` : ''}${stashCount ? ` · stash:${stashCount}` : ''}`
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
