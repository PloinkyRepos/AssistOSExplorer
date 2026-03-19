import { parseDetailedDirectoryListing, joinPath } from "../../pages/file-exp/file-exp-utils.js";
import { parseJsonToolResult, isReposRootPath, normalizeErrorMessage } from "./git-commit-modal-utils.js";
import { getRepoScanPaths, getInternalReposRoot } from "../../../utils/reposRoot.js";
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

    const getRepoTreePresenter = () => element.querySelector('git-repo-tree')?.webSkelPresenter || null;
    const internalReposRoot = getInternalReposRoot({ rootHint: state.reposRoot });

    const mergeRepoResults = (collections = []) => {
        const merged = [];
        const seenPaths = new Set();
        for (const collection of collections) {
            for (const repo of Array.isArray(collection) ? collection : []) {
                const repoPath = String(repo?.path || '').trim();
                if (!repoPath || seenPaths.has(repoPath)) continue;
                seenPaths.add(repoPath);
                const relativePath = String(repo?.relativePath || repo?.name || '').replace(/^\/+/, '');
                const nextRelativePath = repoPath.startsWith(`${internalReposRoot}/`)
                    ? `.ploinky/repos/${relativePath || repoPath.slice(internalReposRoot.length + 1)}`
                    : relativePath;
                merged.push({
                    ...repo,
                    relativePath: nextRelativePath || relativePath
                });
            }
        }
        return merged.sort((a, b) => {
            const left = String(a?.relativePath || a?.name || a?.path || '');
            const right = String(b?.relativePath || b?.name || b?.path || '');
            return left.localeCompare(right, undefined, { sensitivity: 'base' });
        });
    };

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
        const filtered = repos.filter((repo) => {
            if (!repo) return false;
            const counts = repo.counts || {};
            const ignoredCount = Number.isFinite(repo.ignoredCount)
                ? repo.ignoredCount
                : (Array.isArray(repo.ignored) ? repo.ignored.length : 0);
            return Boolean(
                repo.dirty
                || counts.staged
                || counts.unstaged
                || counts.untracked
                || counts.conflicted
                || ignoredCount
            );
        });
        return filtered.length ? filtered : repos;
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
        const presenter = getRepoTreePresenter();
        if (!presenter?.setState) return;
        presenter.setState({
            reposRoot: state.reposRoot || '',
            repos: Array.isArray(overviews) ? overviews : [],
            loading: Boolean(state.repoOverviewsLoading && !state.suppressInlineLoading),
            repoTreeExpanded: state.repoTreeExpanded || {},
            repoChangesExpanded: state.repoChangesExpanded || {},
            treeExpandedByRepo: state.treeExpandedByRepo || {},
            selectionState: state.selectedFilesByRepo || {},
            selectedPath: state.selectedPath || '',
            selectedRepoPath: state.selectedRepoPath || state.repoPath || ''
        });
    };

    const loadRepoOverviews = async ({ force = false } = {}) => {
        const now = Date.now();
        if (!force && repoOverviewCache.list && now - repoOverviewCache.at < 1500) {
            state.repoOverviews = repoOverviewCache.list;
            state.repoOverviewsLoaded = true;
            renderRepoOverviews(state.repoOverviews);
            return state.repoOverviews;
        }
        if (state.repoOverviewsLoading) {
            return repoOverviewCache.promise || state.repoOverviews;
        }
        state.repoOverviewsLoading = true;
        renderRepoOverviews([]);
        const pending = (async () => {
            try {
                const resultSets = [];
                const scanPaths = getRepoScanPaths({ rootHint: state.reposRoot });
                for (const scanPath of scanPaths) {
                    if (!scanPath) continue;
                    try {
                        const payload = parseJsonToolResult(await service.gitReposOverview(scanPath)) || {};
                        const results = Array.isArray(payload.repos) ? payload.repos : [];
                        if (results.length) {
                            resultSets.push(results);
                        }
                    } catch {
                        // try next path
                    }
                }
                const hintMap = state.ignoreHints || {};
                const merged = mergeRepoResults(resultSets).map((repo) => {
                    const hints = Array.isArray(hintMap[repo?.path]) ? hintMap[repo.path] : [];
                    return hints.length ? { ...repo, ignoredHints: hints } : repo;
                });
                state.repoOverviews = merged;
                state.repoOverviewsLoaded = true;
                repoOverviewCache.at = now;
                repoOverviewCache.list = merged;
                applyDefaultRepoTreeExpansion();
                renderRepoOverviews(merged);
                return merged;
            } catch (error) {
                try {
                    const fallbackCollections = [];
                    const scanPaths = getRepoScanPaths({ rootHint: state.reposRoot, includeWorkspaceFallback: false });
                    for (const scanPath of scanPaths) {
                        const listingText = await service.listDirectoryDetailed(scanPath);
                        const entries = parseDetailedDirectoryListing(listingText);
                        const listed = (entries || [])
                            .filter((entry) => entry && entry.type === 'directory' && entry.name && !String(entry.name).startsWith('.'))
                            .map((entry) => ({
                                name: entry.name,
                                path: joinPath(scanPath, entry.name),
                                relativePath: joinPath(scanPath === internalReposRoot ? '.ploinky/repos' : '', entry.name).replace(/^\/+/, ''),
                                ok: true,
                                branch: null,
                                counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
                                sample: { staged: [], unstaged: [], untracked: [], conflicted: [] }
                            }));
                        fallbackCollections.push(listed);
                    }
                    const results = mergeRepoResults(fallbackCollections);
                    state.repoOverviews = results;
                    state.repoOverviewsLoaded = true;
                    repoOverviewCache.at = now;
                    repoOverviewCache.list = results;
                    applyDefaultRepoTreeExpansion();
                    renderRepoOverviews(results);
                    setStatusLine(`Loaded repositories list (status unavailable): ${normalizeErrorMessage(error)}`, true);
                    return results;
                } catch (fallbackError) {
                    state.repoOverviews = [];
                    state.repoOverviewsLoaded = true;
                    renderRepoOverviews([]);
                    setStatusLine(normalizeErrorMessage(fallbackError) || normalizeErrorMessage(error), true);
                    return state.repoOverviews;
                }
            } finally {
                state.repoOverviewsLoading = false;
                renderRepoOverviews(state.repoOverviews);
                repoOverviewCache.promise = null;
            }
        })();
        repoOverviewCache.promise = pending;
        return pending;
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

    const refreshAll = async ({ force = false, keepStatus = false } = {}) => {
        const shouldSetStatus = !keepStatus;
        if (shouldSetStatus) {
            setStatusLine('Loading git status…');
        }
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
                if (shouldSetStatus) {
                    setStatusLine('Select a repository from the list.');
                }
                return;
            }

            const repoInfo = await loadRepoInfo({ force });
            if (repoInfo && repoInfo.ok === false) {
                updateCommitButtons();
                if (shouldSetStatus) {
                    setStatusLine('Select a repository from the list.');
                }
                return;
            }
            reconcileSelectedDiffWithChanges();
            updateCommitButtons();
            if (shouldSetStatus) {
                setStatusLine('Ready.');
            }
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
        }
    };

    const getAllChangedPathsForRepo = (repoPath) => {
        const repo = (state.repoOverviews || []).find((r) => r?.path === repoPath) || null;
        const rows = Array.isArray(repo?.changesAll) ? repo.changesAll : [];
        return rows.map((r) => (typeof r === 'string' ? r : String(r?.path || ''))).filter(Boolean);
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
            out.add(file);
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
