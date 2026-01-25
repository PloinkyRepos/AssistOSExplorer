import { normalizeErrorMessage, isReposRootPath } from "./git-commit-modal-utils.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";

export function createIgnoreActions(ctx) {
    const {
        getState,
        applyState,
        service,
        setStatusLine,
        updateCommitButtons,
        updateIgnorePrompt,
        getSelectedReposForBatch,
        getPathsForCommitInRepo,
        loadRepoOverviews,
        refreshAll
    } = ctx;

    const resolveIgnoreRepoPath = () => {
        const state = getState();
        const selectedRepo = state.selectedRepoPath;
        if (selectedRepo && !isReposRootPath(selectedRepo, state.reposRoot)) return selectedRepo;
        if (state.repoPath && !isReposRootPath(state.repoPath, state.reposRoot)) return state.repoPath;
        const selected = getSelectedReposForBatch();
        if (selected.length === 1) return selected[0];
        return '';
    };

    const getUntrackedPathsForRepo = (repoPath) => {
        const state = getState();
        const repo = (state.repoOverviews || []).find((item) => item?.path === repoPath) || null;
        const rows = Array.isArray(repo?.changesAll) ? repo.changesAll : [];
        if (rows.length && typeof rows[0] === 'string') {
            const untracked = Array.isArray(repo?.changes?.untracked) ? repo.changes.untracked : [];
            return untracked
                .map((row) => String(row || '').trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        }
        return rows
            .filter((row) => {
                if (!row) return false;
                const flags = row.flags || {};
                if (flags.untracked) return true;
                if (row.kind === 'untracked') return true;
                return row.x === '?' && row.y === '?';
            })
            .map((row) => String(row.path || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
    };

    const normalizeIgnorePattern = (value) => String(value || '').trim().replace(/^\.\/+/, '');

    const buildIgnorePatterns = (paths, { mode = 'file', anchor = true } = {}) => {
        const out = [];
        const seen = new Set();
        const list = Array.isArray(paths) ? paths : [];
        for (const raw of list) {
            const normalized = normalizeIgnorePattern(raw);
            if (!normalized) continue;
            let pattern = normalized;
            if (mode === 'folder') {
                const parts = normalized.split('/').filter(Boolean);
                if (parts.length > 1) {
                    pattern = `${parts.slice(0, -1).join('/')}/`;
                }
            }
            if (anchor && !pattern.startsWith('/')) {
                pattern = `/${pattern}`;
            }
            if (seen.has(pattern)) continue;
            seen.add(pattern);
            out.push(pattern);
        }
        return out.join('\n');
    };

    const openGitIgnorePrompt = (options = {}) => {
        const repoPath = options.repoPath || resolveIgnoreRepoPath();
        if (!repoPath) {
            const selected = getSelectedReposForBatch();
            const message = selected.length > 1
                ? 'Select files from a single repository to edit .gitignore.'
                : 'Select a repository to edit .gitignore.';
            setStatusLine(message, true);
            return;
        }
        const overridePaths = Array.isArray(options.paths) ? options.paths.filter(Boolean) : [];
        const selectedPaths = overridePaths.length ? overridePaths : getPathsForCommitInRepo(repoPath);
        const fallbackPaths = selectedPaths.length ? selectedPaths : getUntrackedPathsForRepo(repoPath);
        const source = options.source || (selectedPaths.length ? 'selection' : (fallbackPaths.length ? 'untracked' : 'manual'));
        const mode = options.mode || 'file';
        const anchor = options.anchor !== undefined ? Boolean(options.anchor) : true;
        const overridePatterns = typeof options.patterns === 'string' ? options.patterns.trim() : '';
        const patterns = overridePatterns || buildIgnorePatterns(fallbackPaths, { mode, anchor });
        applyState({
            ignorePrompt: {
                visible: true,
                repoPath,
                mode,
                anchor,
                patterns,
                paths: fallbackPaths,
                source,
                stopTracking: Boolean(options.stopTracking)
            }
        });
        updateIgnorePrompt({ focus: 'patterns' });
        updateCommitButtons();
        if (!fallbackPaths.length) {
            setStatusLine('No files selected. Add ignore patterns manually.');
        }
    };

    const setIgnoreMode = ({ mode } = {}) => {
        const state = getState();
        const next = String(mode || '').trim();
        if (next !== 'file' && next !== 'folder') return;
        const anchor = state.ignorePrompt?.anchor !== false;
        const paths = Array.isArray(state.ignorePrompt?.paths) ? state.ignorePrompt.paths : [];
        const patterns = paths.length
            ? buildIgnorePatterns(paths, { mode: next, anchor })
            : (state.ignorePrompt?.patterns || '');
        applyState({
            ignorePrompt: {
                ...state.ignorePrompt,
                mode: next,
                anchor,
                patterns
            }
        });
        updateIgnorePrompt();
        updateCommitButtons();
    };

    const setIgnoreAnchor = ({ anchor } = {}) => {
        const state = getState();
        const next = typeof anchor === 'boolean' ? anchor : Boolean(anchor);
        const mode = state.ignorePrompt?.mode || 'file';
        const paths = Array.isArray(state.ignorePrompt?.paths) ? state.ignorePrompt.paths : [];
        const patterns = paths.length
            ? buildIgnorePatterns(paths, { mode, anchor: next })
            : (state.ignorePrompt?.patterns || '');
        applyState({
            ignorePrompt: {
                ...state.ignorePrompt,
                anchor: next,
                patterns
            }
        });
        updateIgnorePrompt();
        updateCommitButtons();
    };

    const cancelGitIgnore = () => {
        applyState({
            ignorePrompt: {
                visible: false,
                repoPath: null,
                mode: 'file',
                anchor: true,
                patterns: '',
                paths: [],
                source: 'manual',
                stopTracking: false
            }
        });
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
    };

    const isMissingFileError = (error) => {
        const message = normalizeErrorMessage(error).toLowerCase();
        return message.includes('no such file') || message.includes('enoent') || message.includes('not found');
    };

    const saveGitIgnore = async (payload = {}) => {
        const state = getState();
        const repoPath = state.ignorePrompt?.repoPath;
        if (!repoPath) return;
        const raw = String(payload.patterns ?? state.ignorePrompt?.patterns ?? '').trim();
        if (!raw) {
            setStatusLine('Enter at least one ignore pattern.', true);
            updateIgnorePrompt({ focus: 'patterns' });
            return;
        }
        const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) {
            setStatusLine('Enter at least one ignore pattern.', true);
            updateIgnorePrompt({ focus: 'patterns' });
            return;
        }

        const ignorePath = `${String(repoPath).replace(/\/+$/g, '')}/.gitignore`;
        const stopTracking = Boolean(state.ignorePrompt?.stopTracking);
        const ignoredPaths = Array.isArray(state.ignorePrompt?.paths) ? state.ignorePrompt.paths : [];
        return withGlobalLoader(async () => {
            try {
                let existing = '';
                try {
                    existing = await service.readTextFile(ignorePath);
                } catch (error) {
                    if (!isMissingFileError(error)) throw error;
                }
                const existingLines = String(existing || '').split(/\r?\n/);
                const existingSet = new Set(existingLines.map((line) => line.trim()).filter(Boolean));
                const toAdd = lines.filter((line) => !existingSet.has(line));
                if (!toAdd.length && !stopTracking) {
                    applyState({
                        ignorePrompt: {
                            visible: false,
                            repoPath: null,
                            mode: 'file',
                            anchor: true,
                            patterns: '',
                            paths: [],
                            source: 'manual',
                            stopTracking: false
                        }
                    });
                    updateCommitButtons();
                    setStatusLine('All patterns are already in .gitignore.');
                    return;
                }

                if (stopTracking && ignoredPaths.length) {
                    await service.gitUntrack(repoPath, ignoredPaths);
                }
                if (toAdd.length) {
                    const needsNewline = existing && !existing.endsWith('\n');
                    const nextContent = `${existing}${needsNewline ? '\n' : ''}${toAdd.join('\n')}\n`;
                    await service.writeFile(ignorePath, nextContent);
                }
                if (!stopTracking && ignoredPaths.length) {
                    const map = state.ignoreHints || {};
                    const current = new Set(Array.isArray(map[repoPath]) ? map[repoPath] : []);
                    for (const path of ignoredPaths) {
                        const normalized = normalizeIgnorePattern(path);
                        if (normalized) current.add(normalized);
                    }
                    map[repoPath] = Array.from(current);
                    applyState({ ignoreHints: map }, { silent: true });
                }

                let nextSelectedFiles = state.selectedFilesByRepo;
                if (state.selectedFilesByRepo && state.selectedFilesByRepo[repoPath]) {
                    const entry = state.selectedFilesByRepo[repoPath];
                    if (entry?.files && entry.files.size && ignoredPaths.length) {
                        const nextFiles = new Set(entry.files);
                        for (const path of ignoredPaths) {
                            nextFiles.delete(path);
                        }
                        const nextEntry = { ...entry, files: nextFiles };
                        if (!nextFiles.size && (!entry.prefixes || entry.prefixes.size === 0)) {
                            const nextSelected = { ...state.selectedFilesByRepo };
                            delete nextSelected[repoPath];
                            nextSelectedFiles = nextSelected;
                        } else {
                            nextSelectedFiles = { ...state.selectedFilesByRepo, [repoPath]: nextEntry };
                        }
                    }
                }
                applyState({
                    ignorePrompt: {
                        visible: false,
                        repoPath: null,
                        mode: 'file',
                        anchor: true,
                        patterns: '',
                        paths: [],
                        source: 'manual',
                        stopTracking: false
                    },
                    selectedFilesByRepo: nextSelectedFiles
                });
                updateCommitButtons();
                await loadRepoOverviews({ force: true });
                await refreshAll({ force: true });
                if (stopTracking && toAdd.length) {
                    setStatusLine(`Stopped tracking ${ignoredPaths.length} file(s) and added ${toAdd.length} pattern(s).`);
                } else if (stopTracking) {
                    setStatusLine(`Stopped tracking ${ignoredPaths.length} file(s).`);
                } else {
                    setStatusLine(`Added ${toAdd.length} pattern(s) to .gitignore.`);
                }
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    };

    return {
        openGitIgnorePrompt,
        setIgnoreMode,
        setIgnoreAnchor,
        cancelGitIgnore,
        saveGitIgnore
    };
}
