import { normalizePath, parsePatterns } from "../../pages/file-exp/file-exp-utils.js";
import {
    buildSearchHighlightRegex,
    groupSearchMatchesByFileDetailed,
    mergeSearchMatchesByPaths,
    normalizeSearchTextMatches,
    parseToolJsonPayload,
    withTimeout
} from "../../utils/workspace-search-utils.js";

const SEARCH_DEBOUNCE_MS = 200;

function normalizePathList(paths = []) {
    return Array.from(new Set(
        (Array.isArray(paths) ? paths : [])
            .map((entry) => normalizePath(String(entry || "").trim()))
            .filter(Boolean)
    )).sort();
}

export const fileSearchModalSearchMethods = {
    scheduleSearchByName() {
        if (this.state.searchByNameTimer) {
            clearTimeout(this.state.searchByNameTimer);
        }
        this.state.searchByNameTimer = setTimeout(() => this.runSearchByName(), SEARCH_DEBOUNCE_MS);
    },

    scheduleSearchInFiles() {
        if (this.state.searchInFilesTimer) {
            clearTimeout(this.state.searchInFilesTimer);
        }
        this.state.replaceInFilesError = null;
        this.state.replaceInFilesSummary = null;
        this.renderReplaceStatus();
        const query = (this.state.searchInFilesQuery || "").trim();
        if (!query) {
            this.searchInFilesRequestId += 1;
            this.state.searchInFilesLoading = false;
            this.state.searchInFilesRefreshing = false;
            this.state.searchInFilesError = "Enter text to search for.";
            this.state.searchInFilesResults = [];
            this.state.searchInFilesFileResults = [];
            this.state.searchInFilesTruncated = false;
            this.state.searchInFilesTimedOut = false;
            this.state.selectedMatchIds = new Set();
            this.resetSearchInFilesProgressiveWindow();
            this.renderSearchInFilesResults();
            return;
        }
        this.state.searchInFilesTimer = setTimeout(() => this.runSearchInFiles(), SEARCH_DEBOUNCE_MS);
    },

    buildSearchInFilesCacheKey({ paths = [] } = {}) {
        const basePath = this.resolveSearchBasePath();
        const query = (this.state.searchInFilesQuery || "").trim();
        const exclude = this.state.searchInFilesExclude || this.defaultExclude;
        const caseSensitive = Boolean(this.state.searchInFilesCase);
        const useRegex = Boolean(this.state.searchInFilesRegex);
        const wholeWord = Boolean(this.state.searchInFilesWholeWord);
        const workspaceVersion = Number.isFinite(this.state.workspaceVersion) ? this.state.workspaceVersion : 0;
        const normalizedPaths = normalizePathList(paths);
        return JSON.stringify({
            basePath,
            query,
            exclude,
            caseSensitive,
            useRegex,
            wholeWord,
            workspaceVersion,
            paths: normalizedPaths
        });
    },

    getCachedSearchInFilesResult(key) {
        const value = this.searchInFilesCache.get(key);
        this.refreshSearchInFilesCacheStats();
        return value;
    },

    setCachedSearchInFilesResult(key, value) {
        this.searchInFilesCache.set(key, value);
        this.refreshSearchInFilesCacheStats();
    },

    refreshSearchInFilesCacheStats() {
        if (typeof this.searchInFilesCache?.getStats !== "function") {
            return;
        }
        this.state.searchInFilesCacheStats = this.searchInFilesCache.getStats();
    },

    setSearchInFilesMatches(matches = [], { truncated = false, preserveSelection = false, timedOut = false } = {}) {
        const normalizedMatches = normalizeSearchTextMatches(matches);
        this.state.searchInFilesResults = normalizedMatches;
        this.state.searchInFilesFileResults = groupSearchMatchesByFileDetailed(normalizedMatches);
        if (preserveSelection) {
            const currentSelection = this.state.selectedMatchIds instanceof Set ? this.state.selectedMatchIds : new Set();
            const available = new Set(normalizedMatches.map((item) => item.id));
            const nextSelection = new Set();
            currentSelection.forEach((id) => {
                if (available.has(id)) {
                    nextSelection.add(id);
                }
            });
            this.state.selectedMatchIds = nextSelection;
        } else {
            this.state.selectedMatchIds = new Set(normalizedMatches.map((item) => item.id));
        }
        this.state.searchInFilesTruncated = Boolean(truncated);
        this.state.searchInFilesTimedOut = Boolean(timedOut);
        this.resetSearchInFilesProgressiveWindow();
    },

    buildClientSearchMatchPreview(line, matchStart, matchLength) {
        const value = String(line ?? "");
        const contextBefore = 60;
        const contextAfter = 50;
        const start = Math.max(0, matchStart - contextBefore);
        const end = Math.min(value.length, matchStart + Math.max(0, matchLength) + contextAfter);
        const snippet = value.slice(start, end);
        const prefix = start > 0 ? "..." : "";
        const suffix = end < value.length ? "..." : "";
        return `${prefix}${snippet}${suffix}`;
    },

    findSearchMatchesInTextForPath(filePath, fileText) {
        const regex = buildSearchHighlightRegex({
            query: this.state.searchInFilesQuery,
            useRegex: this.state.searchInFilesRegex,
            wholeWord: this.state.searchInFilesWholeWord,
            caseSensitive: this.state.searchInFilesCase
        });
        if (!regex) {
            return [];
        }

        const normalizedFilePath = normalizePath(filePath);
        const lines = String(fileText ?? "").split(/\r?\n/);
        const results = [];
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const lineText = lines[lineIndex] ?? "";
            regex.lastIndex = 0;
            let match;
            let matchIndex = 0;
            while ((match = regex.exec(lineText)) !== null) {
                const matchText = String(match[0] ?? "");
                const column = (Number.isFinite(match.index) ? match.index : 0) + 1;
                results.push({
                    path: normalizedFilePath,
                    line: lineIndex + 1,
                    column,
                    matchIndex,
                    match: matchText,
                    preview: this.buildClientSearchMatchPreview(lineText, column - 1, matchText.length),
                    id: `${normalizedFilePath}:${lineIndex + 1}:${column}:${matchIndex}`
                });
                matchIndex += 1;
                if (matchText.length === 0) {
                    const safeIndex = Number.isFinite(match.index) ? match.index : 0;
                    regex.lastIndex = safeIndex + 1;
                }
            }
        }
        return results;
    },

    async runSearchByName() {
        const query = (this.state.searchByNameQuery || "").trim();
        if (!query) {
            this.state.searchByNameResults = [];
            this.state.searchByNameError = null;
            this.renderSearchByNameResults();
            return;
        }
        if (query.length < 2) {
            this.state.searchByNameResults = [];
            this.state.searchByNameError = "Type at least 2 characters.";
            this.renderSearchByNameResults();
            return;
        }

        this.state.searchByNameLoading = true;
        this.state.searchByNameError = null;
        this.renderSearchByNameResults();
        try {
            const excludePatterns = parsePatterns(this.state.searchByNameExclude);
            const result = await withTimeout(
                () => this.callTool("explorer", "search_files", {
                    path: this.state.basePath || "/",
                    pattern: query,
                    excludePatterns,
                    workspaceVersion: Number.isFinite(this.state.workspaceVersion) ? this.state.workspaceVersion : 0
                }),
                {
                    timeoutMs: this.searchInFilesRequestTimeoutMs,
                    timeoutMessage: `Search timed out after ${Math.ceil(this.searchInFilesRequestTimeoutMs / 1000)}s.`
                }
            );
            const payload = parseToolJsonPayload(result);
            const paths = Array.isArray(payload?.results)
                ? payload.results
                : (result.text || "")
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line) => line && !line.toLowerCase().includes("no matches"));
            const items = paths.map((line) => {
                const normalized = normalizePath(line.startsWith("/") ? line : `/${line}`);
                const name = normalized.split("/").pop() || "/";
                return {
                    path: normalized,
                    name,
                    displayPath: normalized
                };
            });
            this.state.searchByNameResults = items;
        } catch (error) {
            console.error("search_files failed", error);
            this.state.searchByNameError = error?.message || "Search failed.";
            this.state.searchByNameResults = [];
        } finally {
            this.state.searchByNameLoading = false;
            this.renderSearchByNameResults();
        }
    },

    async runSearchInFiles({
        paths = [],
        preserveSelection = false,
        mergeWithCurrent = false,
        skipCache = false,
        refreshOnly = false
    } = {}) {
        const query = (this.state.searchInFilesQuery || "").trim();
        if (!query) {
            this.state.searchInFilesResults = [];
            this.state.searchInFilesError = "Enter text to search for.";
            this.state.searchInFilesFileResults = [];
            this.state.searchInFilesTruncated = false;
            this.state.searchInFilesTimedOut = false;
            this.state.selectedMatchIds = new Set();
            this.resetSearchInFilesProgressiveWindow();
            this.renderSearchInFilesResults();
            return null;
        }

        const scopedPaths = normalizePathList(paths);
        const hasScopedPaths = scopedPaths.length > 0;
        const requestId = ++this.searchInFilesRequestId;
        this.state.searchInFilesLoading = !refreshOnly;
        this.state.searchInFilesRefreshing = Boolean(refreshOnly);
        this.state.searchInFilesError = null;
        if (!hasScopedPaths) {
            this.state.searchInFilesTruncated = false;
            this.state.searchInFilesTimedOut = false;
        }
        this.renderSearchInFilesResults();
        try {
            const cacheKey = this.buildSearchInFilesCacheKey({ paths: scopedPaths });
            const cached = skipCache ? null : this.getCachedSearchInFilesResult(cacheKey);
            if (cached) {
                const cachedMatches = normalizeSearchTextMatches(cached.matches || []);
                if (mergeWithCurrent && hasScopedPaths) {
                    const merged = mergeSearchMatchesByPaths({
                        currentMatches: this.state.searchInFilesResults,
                        refreshedMatches: cachedMatches,
                        refreshedPaths: scopedPaths
                    });
                    this.setSearchInFilesMatches(merged, {
                        truncated: Boolean(this.state.searchInFilesTruncated),
                        preserveSelection,
                        timedOut: Boolean(this.state.searchInFilesTimedOut)
                    });
                } else {
                    this.setSearchInFilesMatches(cachedMatches, {
                        truncated: Boolean(cached.truncated),
                        preserveSelection,
                        timedOut: Boolean(cached.timedOut)
                    });
                }
                return { fromCache: true, timedOut: Boolean(cached.timedOut) };
            }

            const excludePatterns = parsePatterns(this.state.searchInFilesExclude);
            const searchArgs = {
                path: this.resolveSearchBasePath(),
                query,
                caseSensitive: this.state.searchInFilesCase,
                useRegex: this.state.searchInFilesRegex,
                wholeWord: this.state.searchInFilesWholeWord,
                excludePatterns,
                workspaceVersion: Number.isFinite(this.state.workspaceVersion) ? this.state.workspaceVersion : 0
            };
            if (hasScopedPaths) {
                searchArgs.paths = scopedPaths;
            }
            const result = await withTimeout(
                () => this.callTool("explorer", "search_text", searchArgs),
                {
                    timeoutMs: this.searchInFilesRequestTimeoutMs,
                    timeoutMessage: `Search timed out after ${Math.ceil(this.searchInFilesRequestTimeoutMs / 1000)}s.`
                }
            );
            if (requestId !== this.searchInFilesRequestId) {
                return null;
            }
            const payload = parseToolJsonPayload(result);
            const normalizedMatches = normalizeSearchTextMatches(payload?.results || []);
            const timedOut = Boolean(payload?.timedOut);
            if (mergeWithCurrent && hasScopedPaths) {
                const merged = mergeSearchMatchesByPaths({
                    currentMatches: this.state.searchInFilesResults,
                    refreshedMatches: normalizedMatches,
                    refreshedPaths: scopedPaths
                });
                this.setSearchInFilesMatches(merged, {
                    truncated: Boolean(this.state.searchInFilesTruncated) || Boolean(payload?.truncated),
                    preserveSelection,
                    timedOut: Boolean(this.state.searchInFilesTimedOut) || timedOut
                });
            } else {
                this.setSearchInFilesMatches(normalizedMatches, {
                    truncated: Boolean(payload?.truncated),
                    preserveSelection,
                    timedOut
                });
            }
            this.setCachedSearchInFilesResult(cacheKey, {
                matches: normalizedMatches,
                truncated: Boolean(payload?.truncated),
                timedOut
            });
            return { timedOut };
        } catch (error) {
            if (requestId !== this.searchInFilesRequestId) {
                return null;
            }
            console.error("search_text failed", error);
            if (refreshOnly) {
                return { error };
            }
            this.state.searchInFilesError = error?.message || "Search failed.";
            this.state.searchInFilesResults = [];
            this.state.searchInFilesFileResults = [];
            this.state.searchInFilesTruncated = false;
            this.state.searchInFilesTimedOut = false;
            this.state.selectedMatchIds = new Set();
            this.resetSearchInFilesProgressiveWindow();
            return { error };
        } finally {
            if (requestId !== this.searchInFilesRequestId) {
                return;
            }
            this.state.searchInFilesLoading = false;
            this.state.searchInFilesRefreshing = false;
            this.renderSearchInFilesResults();
            this.updateReplaceButtons();
        }
    },

    async refreshSearchInFilesForPaths(paths = []) {
        const scopedPaths = normalizePathList(paths);
        if (!scopedPaths.length) {
            return { skipped: true };
        }
        const query = (this.state.searchInFilesQuery || "").trim();
        if (!query) {
            return { skipped: true };
        }

        const requestId = ++this.searchInFilesRequestId;
        this.state.searchInFilesRefreshing = true;
        this.state.searchInFilesError = null;
        this.renderSearchInFilesResults();
        this.updateReplaceButtons();

        const timeoutMs = Math.max(1000, Math.min(this.searchInFilesRequestTimeoutMs, 5000));
        const collectedMatches = [];
        let hadErrors = false;
        try {
            for (const pathValue of scopedPaths) {
                if (requestId !== this.searchInFilesRequestId) {
                    return { cancelled: true };
                }
                try {
                    const result = await withTimeout(
                        () => this.callTool("explorer", "read_text_file", { path: pathValue }),
                        {
                            timeoutMs,
                            timeoutMessage: `Refresh timed out after ${Math.ceil(timeoutMs / 1000)}s.`
                        }
                    );
                    if (requestId !== this.searchInFilesRequestId) {
                        return { cancelled: true };
                    }
                    const text = typeof result?.text === "string" ? result.text : "";
                    const fileMatches = this.findSearchMatchesInTextForPath(pathValue, text);
                    collectedMatches.push(...fileMatches);
                } catch (error) {
                    hadErrors = true;
                    console.warn("Failed to refresh file after replace", pathValue, error);
                }
            }

            if (requestId !== this.searchInFilesRequestId) {
                return { cancelled: true };
            }

            const merged = mergeSearchMatchesByPaths({
                currentMatches: this.state.searchInFilesResults,
                refreshedMatches: collectedMatches,
                refreshedPaths: scopedPaths
            });
            this.setSearchInFilesMatches(merged, {
                truncated: Boolean(this.state.searchInFilesTruncated),
                preserveSelection: true,
                timedOut: false
            });
            this.setCachedSearchInFilesResult(this.buildSearchInFilesCacheKey({ paths: scopedPaths }), {
                matches: collectedMatches,
                truncated: false,
                timedOut: false
            });
            return { ok: !hadErrors, hadErrors };
        } finally {
            if (requestId === this.searchInFilesRequestId) {
                this.state.searchInFilesRefreshing = false;
                this.renderSearchInFilesResults();
                this.updateReplaceButtons();
            }
        }
    }
};
