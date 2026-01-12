import { parseDetailedDirectoryListing, joinPath } from "../../pages/file-exp/file-exp-utils.js";
import { parseJsonToolResult, isReposRootPath, normalizeErrorMessage } from "./git-commit-modal-utils.js";
import {
    ensureSelectionEntry,
    peekSelectionEntry,
    isPathSelected,
    getCoveringPrefix as getCoveringPrefixFromEntry,
    getAncestorCoveringPrefix as getAncestorCoveringPrefixFromEntry,
    toggleFileSelection as toggleFileSelectionOnEntry,
    togglePrefixSelection as togglePrefixSelectionOnEntry
} from "./git-commit-modal-selection.js";
import { formatRepoSummary, renderRepoChangesTree as renderRepoChangesTreeInternal } from "./git-commit-modal-tree.js";

export function createGitCommitRepo(ctx) {
    const {
        element,
        state,
        service,
        statusCache,
        repoOverviewCache,
        setStatusLine,
        updateCommitButtons,
        clearSelectedDiff
    } = ctx;

    const getSelectedFilesEntry = (repoPath) => {
        if (!repoPath) return null;
        const store = state.selectedFilesByRepo || {};
        const entry = ensureSelectionEntry(store, repoPath);
        state.selectedFilesByRepo = store;
        return entry;
    };

    const peekSelectedFilesEntry = (repoPath) => peekSelectionEntry(state.selectedFilesByRepo, repoPath);

    const isFileSelected = (repoPath, filePath) => {
        const entry = peekSelectionEntry(state.selectedFilesByRepo, repoPath);
        return isPathSelected(entry, filePath);
    };

    const toggleFileSelection = (repoPath, filePath, section, isSelected) => {
        if (!repoPath || !filePath) return;
        const entry = getSelectedFilesEntry(repoPath);
        if (!entry) return;
        toggleFileSelectionOnEntry(entry, filePath, section, isSelected);
        updateCommitButtons();
        renderRepoOverviews(state.repoOverviews);
    };

    const getCoveringPrefix = (repoPath, relativePath) => {
        const entry = peekSelectionEntry(state.selectedFilesByRepo, repoPath);
        return getCoveringPrefixFromEntry(entry, relativePath);
    };

    const getAncestorCoveringPrefix = (repoPath, prefix) => {
        const entry = peekSelectionEntry(state.selectedFilesByRepo, repoPath);
        return getAncestorCoveringPrefixFromEntry(entry, prefix);
    };

    const togglePrefixSelection = (repoPath, prefix, isSelected) => {
        if (!repoPath) return;
        const entry = getSelectedFilesEntry(repoPath);
        if (!entry) return;
        togglePrefixSelectionOnEntry(entry, prefix, isSelected);
        updateCommitButtons();
        renderRepoOverviews(state.repoOverviews);
    };

    const toggleFolderExpanded = (folderId) => {
        if (!folderId) return;
        const expanded = { ...(state.repoTreeExpanded || {}) };
        expanded[folderId] = expanded[folderId] === true ? false : true;
        state.repoTreeExpanded = expanded;
        renderRepoOverviews(state.repoOverviews);
    };

    const toggleRepoChanges = (elementNode) => {
        const repoPath = elementNode?.dataset?.repoPath;
        if (!repoPath) return;
        const expanded = { ...(state.repoChangesExpanded || {}) };
        const current = expanded[repoPath];
        expanded[repoPath] = current === undefined ? false : !current;
        state.repoChangesExpanded = expanded;
        renderRepoOverviews(state.repoOverviews);
    };

    const isRepoChangesExpanded = (repoPath) => {
        if (!repoPath) return true;
        const current = state.repoChangesExpanded?.[repoPath];
        return current === undefined ? true : Boolean(current);
    };

    const toggleTreeFolder = (elementNode) => {
        const repoPath = elementNode?.dataset?.repoPath;
        const prefix = elementNode?.dataset?.prefix;
        if (!repoPath || !prefix) return;
        const key = `${repoPath}::${prefix}`;
        const expanded = { ...(state.treeExpandedByRepo || {}) };
        const current = expanded[key];
        expanded[key] = current === undefined ? false : !current;
        state.treeExpandedByRepo = expanded;
        renderRepoOverviews(state.repoOverviews);
    };

    const isTreeFolderExpanded = (repoPath, prefix) => {
        if (!repoPath || !prefix) return true;
        const key = `${repoPath}::${prefix}`;
        const current = state.treeExpandedByRepo?.[key];
        return current === undefined ? true : Boolean(current);
    };

    const getDisplayedRepoOverviews = () => {
        const repos = Array.isArray(state.repoOverviews) ? state.repoOverviews : [];
        return repos.filter((repo) => {
            if (!repo) return false;
            const counts = repo.counts || {};
            return Boolean(repo.dirty || counts.staged || counts.unstaged || counts.untracked || counts.conflicted);
        });
    };

    const buildRepoTree = () => {
        const root = { id: '/', name: state.reposRoot, children: new Map(), repos: [], counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } };
        const repos = getDisplayedRepoOverviews();

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
    };

    const applyDefaultRepoTreeExpansion = () => {
        const repos = getDisplayedRepoOverviews();
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
        state.repoTreeExpanded = expanded;
    };

    const renderRepoChangesTree = (repo) => renderRepoChangesTreeInternal(repo, {
        isFileSelected: (repoPath, filePath) => isFileSelected(repoPath, filePath),
        getAncestorCoveringPrefix: (repoPath, prefix) => getAncestorCoveringPrefix(repoPath, prefix),
        getCoveringPrefix: (repoPath, prefix) => getCoveringPrefix(repoPath, prefix),
        isFolderExpanded: (repoPath, prefix) => isTreeFolderExpanded(repoPath, prefix)
    });

    const renderRepoOverviews = (overviews) => {
        const section = element.querySelector('#gitRepoCandidatesSection');
        const container = element.querySelector('#gitRepoCandidatesList');
        if (!section || !container) return;

        container.innerHTML = '';
        const items = Array.isArray(overviews) ? overviews : [];
        const show = true;
        section.style.display = show ? '' : 'none';

        if (state.repoOverviewsLoading && items.length === 0) {
            const loading = document.createElement('div');
            loading.className = 'git-empty';
            loading.textContent = 'Loading repositories…';
            container.appendChild(loading);
            return;
        }

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'git-empty';
            empty.textContent = `No repositories found under ${state.reposRoot}.`;
            container.appendChild(empty);
            return;
        }

        const dirty = getDisplayedRepoOverviews();
        if (dirty.length === 0 && !state.repoOverviewsLoading) {
            const empty = document.createElement('div');
            empty.className = 'git-empty';
            empty.textContent = 'No repositories with changes.';
            container.appendChild(empty);
            return;
        }

        const tree = buildRepoTree();
        const expandedMap = state.repoTreeExpanded || {};

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
            label.textContent = `${folderId === '/' ? state.reposRoot : node.name} · ${badge}`;

            left.appendChild(expandBtn);
            left.appendChild(label);

            row.appendChild(left);
            wrapper.appendChild(row);

            if (!isExpanded) {
                container.appendChild(wrapper);
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
                    ? repo.changesAll.map((c) => String(c?.path || '')).filter(Boolean)
                    : [];
                const selectedCount = changedPaths.reduce((acc, p) => acc + (isFileSelected(repo.path, p) ? 1 : 0), 0);
                const any = selectedCount > 0;
                repoCheckbox.checked = changedPaths.length > 0 && selectedCount === changedPaths.length;
                repoCheckbox.indeterminate = any && selectedCount < changedPaths.length;

                const changesToggle = document.createElement('button');
                changesToggle.type = 'button';
                changesToggle.className = 'secondary git-tree-collapse';
                changesToggle.dataset.repoPath = repo.path;
                changesToggle.setAttribute('data-local-action', 'toggleRepoChanges');
                const repoExpanded = isRepoChangesExpanded(repo.path);
                changesToggle.textContent = repoExpanded ? '▾' : '▸';

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
                const summary = formatRepoSummary(repo);
                info.dataset.tooltip = summary;
                info.title = summary;
                info.setAttribute('aria-label', summary);
                info.textContent = 'i';
                repoLeft.appendChild(info);
                repoRow.appendChild(repoLeft);

                repoWrapper.appendChild(repoRow);

                const hasChanges = Boolean(repo?.dirty || counts.staged || counts.unstaged || counts.untracked || counts.conflicted);
                if (hasChanges && isRepoChangesExpanded(repo.path)) {
                    const changesTree = renderRepoChangesTree(repo);
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
    };

    const loadRepoOverviews = async ({ force = false } = {}) => {
        const now = Date.now();
        if (!force && repoOverviewCache.list && now - repoOverviewCache.at < 1500) {
            state.repoOverviews = repoOverviewCache.list;
            renderRepoOverviews(state.repoOverviews);
            return;
        }
        if (state.repoOverviewsLoading) return;
        state.repoOverviewsLoading = true;
        renderRepoOverviews([]);
        try {
            const payload = parseJsonToolResult(await service.gitReposOverview(state.reposRoot)) || {};
            const results = Array.isArray(payload.repos) ? payload.repos : [];
            state.repoOverviews = results;
            repoOverviewCache.at = now;
            repoOverviewCache.list = results;
            applyDefaultRepoTreeExpansion();
            renderRepoOverviews(results);
        } catch (error) {
            try {
                const listingText = await service.listDirectoryDetailed(state.reposRoot);
                const entries = parseDetailedDirectoryListing(listingText);
                const results = (entries || [])
                    .filter((entry) => entry && entry.type === 'directory' && entry.name && !String(entry.name).startsWith('.'))
                    .map((entry) => ({
                        name: entry.name,
                        path: joinPath(state.reposRoot, entry.name),
                        ok: true,
                        branch: null,
                        counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
                        sample: { staged: [], unstaged: [], untracked: [], conflicted: [] }
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));
                state.repoOverviews = results;
                repoOverviewCache.at = now;
                repoOverviewCache.list = results;
                applyDefaultRepoTreeExpansion();
                renderRepoOverviews(results);
                setStatusLine(`Loaded repositories list (status unavailable): ${normalizeErrorMessage(error)}`, true);
            } catch (fallbackError) {
                state.repoOverviews = [];
                renderRepoOverviews([]);
                setStatusLine(normalizeErrorMessage(fallbackError) || normalizeErrorMessage(error), true);
            }
        } finally {
            state.repoOverviewsLoading = false;
            renderRepoOverviews(state.repoOverviews);
        }
    };

    const applyRepoInfo = (info) => {
        state.branch = info.branch || null;
        state.upstream = info.upstream || null;
        state.remotes = Array.isArray(info.remotes) ? info.remotes : [];
        state.repoInfoOk = info && typeof info.ok === 'boolean' ? info.ok : null;
        const branchInfo = element.querySelector('#gitBranchInfo');
        if (branchInfo) {
            if (info && info.ok === false) {
                branchInfo.textContent = 'Not a git repository. Choose a repo path that contains a .git folder.';
                return;
            }
            const bits = [];
            if (state.branch) bits.push(`Branch: ${state.branch}`);
            if (state.upstream) bits.push(`Upstream: ${state.upstream}`);
            branchInfo.textContent = bits.length ? bits.join(' · ') : 'Not a git repository.';
        }
    };

    const loadRepoInfo = async ({ force = false } = {}) => {
        const cached = statusCache.payload?.repoInfo;
        if (!force && cached) {
            applyRepoInfo(cached);
            return cached;
        }
        const text = await service.gitInfo(state.repoPath);
        const payload = parseJsonToolResult(text) || {};
        statusCache.at = statusCache.at || 0;
        statusCache.payload = {
            ...(statusCache.payload || {}),
            repoInfo: payload
        };
        applyRepoInfo(payload);
        return payload;
    };

    const refreshAll = async ({ force = false } = {}) => {
        setStatusLine('Loading git status…');
        try {
            await loadRepoOverviews({ force });
            reconcileSelectedDiffWithChanges();

            if (isReposRootPath(state.repoPath, state.reposRoot)) {
                state.repoInfoOk = false;
                state.branch = null;
                state.upstream = null;
                state.remotes = [];
                state.selectedRepoPath = null;
                updateCommitButtons();
                const branchInfo = element.querySelector('#gitBranchInfo');
                if (branchInfo) {
                    branchInfo.textContent = 'Multi-repo view. Select a repository to see branch/status.';
                }
                setStatusLine('Select a repository from the list.');
                return;
            }

            const repoInfo = await loadRepoInfo({ force });
            if (repoInfo && repoInfo.ok === false) {
                updateCommitButtons();
                setStatusLine('Select a repository from the list.');
                return;
            }
            reconcileSelectedDiffWithChanges();
            updateCommitButtons();
            setStatusLine('Ready.');
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
        }
    };

    const getAllChangedPathsForRepo = (repoPath) => {
        const repo = (state.repoOverviews || []).find((r) => r?.path === repoPath) || null;
        const rows = Array.isArray(repo?.changesAll) ? repo.changesAll : [];
        return rows.map((r) => String(r?.path || '')).filter(Boolean);
    };

    const reconcileSelectedDiffWithChanges = () => {
        const filePath = state.selectedPath;
        if (!filePath) return;

        const repoPath = state.selectedRepoPath || state.repoPath;
        if (!repoPath || isReposRootPath(repoPath, state.reposRoot)) {
            clearSelectedDiff();
            return;
        }

        const changed = getAllChangedPathsForRepo(repoPath);
        if (changed.length > 0 && !changed.includes(filePath)) {
            clearSelectedDiff();
        }
    };

    const getPathsForCommitInRepo = (repoPath) => {
        const changed = getAllChangedPathsForRepo(repoPath);
        const changedSet = new Set(changed);
        const entry = state.selectedFilesByRepo?.[repoPath] || null;
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
        if (entry?.excludedFiles?.size) {
            for (const filePath of entry.excludedFiles) {
                out.delete(filePath);
            }
        }
        return Array.from(out);
    };

    return {
        refreshAll,
        loadRepoInfo,
        applyRepoInfo,
        loadRepoOverviews,
        applyDefaultRepoTreeExpansion,
        renderRepoOverviews,
        renderRepoChangesTree,
        formatRepoSummary,
        getDisplayedRepoOverviews,
        buildRepoTree,
        toggleFolderExpanded,
        toggleRepoChanges,
        isRepoChangesExpanded,
        toggleTreeFolder,
        isTreeFolderExpanded,
        getSelectedFilesEntry,
        peekSelectedFilesEntry,
        isFileSelected,
        toggleFileSelection,
        getCoveringPrefix,
        getAncestorCoveringPrefix,
        togglePrefixSelection,
        getAllChangedPathsForRepo,
        reconcileSelectedDiffWithChanges,
        getPathsForCommitInRepo
    };
}
