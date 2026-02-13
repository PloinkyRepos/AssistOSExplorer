import { parsePatterns } from "../../pages/file-exp/file-exp-utils.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";
import { FILE_EXP_REPLACE_COMPLETE_EVENT } from "../../../utils/appEvents.js";
import {
    computeOptimisticSearchMatchesAfterReplace,
    filterMatchesByPaths,
    parseToolJsonPayload,
    withTimeout
} from "../../utils/workspace-search-utils.js";

export const fileSearchModalReplaceMethods = {
    pruneSearchInFilesMatchesForChangedPaths(changedPaths = []) {
        const currentMatches = Array.isArray(this.state.searchInFilesResults) ? this.state.searchInFilesResults : [];
        const nextMatches = filterMatchesByPaths(currentMatches, changedPaths);
        if (nextMatches.length === currentMatches.length) {
            return;
        }
        this.setSearchInFilesMatches(nextMatches, {
            truncated: Boolean(this.state.searchInFilesTruncated),
            preserveSelection: false
        });
    },

    applyOptimisticResultsAfterReplace({ selectedOnly, selectedIds = [], changedFiles = [], replacements = 0 }) {
        const currentMatches = Array.isArray(this.state.searchInFilesResults) ? this.state.searchInFilesResults : [];
        const nextMatches = computeOptimisticSearchMatchesAfterReplace({
            matches: currentMatches,
            selectedOnly,
            selectedIds,
            changedFiles,
            replacements
        });
        if (nextMatches === currentMatches) {
            return;
        }
        this.setSearchInFilesMatches(nextMatches, {
            truncated: false,
            preserveSelection: false,
            timedOut: false
        });
    },

    async performReplace({ selectedOnly }) {
        if (this.state.replaceInFilesLoading) return;
        const query = (this.state.searchInFilesQuery || "").trim();
        if (!query) {
            this.state.replaceInFilesError = "Enter text to search for.";
            this.state.replaceInFilesSummary = null;
            this.renderReplaceStatus();
            return;
        }
        const matches = this.state.searchInFilesResults || [];
        if (!matches.length) {
            this.state.replaceInFilesError = "No matches to replace.";
            this.state.replaceInFilesSummary = null;
            this.renderReplaceStatus();
            return;
        }
        const selectedIds = selectedOnly
            ? Array.from(this.state.selectedMatchIds instanceof Set ? this.state.selectedMatchIds : [])
            : [];
        if (selectedOnly && selectedIds.length === 0) {
            this.state.replaceInFilesError = "Select at least one match to replace.";
            this.state.replaceInFilesSummary = null;
            this.renderReplaceStatus();
            return;
        }
        if (!selectedOnly && this.state.searchInFilesTruncated) {
            const proceed = confirm("Search results are truncated. Replace All may affect more matches than shown. Continue?");
            if (!proceed) return;
        }

        const estimated = selectedOnly ? selectedIds.length : matches.length;
        if (estimated >= 1000) {
            const proceed = confirm(`Replace ${estimated} occurrence${estimated === 1 ? "" : "s"}?`);
            if (!proceed) return;
        }

        this.state.replaceInFilesLoading = true;
        this.state.replaceInFilesError = null;
        this.state.replaceInFilesSummary = null;
        this.renderReplaceStatus();
        this.updateReplaceButtons();

        try {
            const excludePatterns = parsePatterns(this.state.searchInFilesExclude);
            const result = await withTimeout(
                () => callToolWithLoader("explorer", "replace_text", {
                    path: this.resolveSearchBasePath(),
                    query,
                    replaceWith: this.state.replaceInFilesWith ?? "",
                    caseSensitive: this.state.searchInFilesCase,
                    useRegex: this.state.searchInFilesRegex,
                    wholeWord: this.state.searchInFilesWholeWord,
                    excludePatterns,
                    selectedMatchIds: selectedOnly ? selectedIds : [],
                    workspaceVersion: Number.isFinite(this.state.workspaceVersion) ? this.state.workspaceVersion : 0,
                    dryRun: false
                }),
                {
                    timeoutMs: this.replaceInFilesRequestTimeoutMs,
                    timeoutMessage: `Replace timed out after ${Math.ceil(this.replaceInFilesRequestTimeoutMs / 1000)}s.`
                }
            );
            const payload = parseToolJsonPayload(result);
            if (!payload) {
                const text = typeof result?.text === "string" ? result.text.trim() : "";
                if (text.startsWith("Error:")) {
                    throw new Error(text.replace(/^Error:\s*/i, "") || "Replace failed.");
                }
                throw new Error("Invalid replace response.");
            }
            const summary = payload?.summary;
            const replacements = summary?.totalReplacements ?? 0;
            const filesChanged = summary?.filesChanged ?? 0;
            if (payload?.errors?.length) {
                console.warn("replace_text errors", payload.errors);
            }
            const missing = summary?.missingMatches || 0;
            const replaceTimedOut = Boolean(payload?.timedOut);
            if (replacements > 0) {
                if (filesChanged > 0) {
                    this.state.replaceInFilesSummary = `Replaced ${replacements} occurrence${replacements === 1 ? "" : "s"} in ${filesChanged} file${filesChanged === 1 ? "" : "s"}.`;
                } else {
                    this.state.replaceInFilesSummary = `Matched ${replacements} occurrence${replacements === 1 ? "" : "s"}, but no file content changed.`;
                }
            } else {
                this.state.replaceInFilesSummary = "No replacements were made.";
            }
            if (missing > 0) {
                this.state.replaceInFilesSummary += ` ${missing} selected match${missing === 1 ? "" : "es"} no longer available.`;
            }
            if (payload?.errors?.length) {
                this.state.replaceInFilesSummary += ` ${payload.errors.length} file${payload.errors.length === 1 ? "" : "s"} failed.`;
            }
            if (replaceTimedOut) {
                this.state.replaceInFilesSummary += " Replace timed out; operation may be partial.";
            }
            this.searchInFilesCache.clear();
            this.refreshSearchInFilesCacheStats?.();
            this.state.workspaceVersion = (Number.isFinite(this.state.workspaceVersion) ? this.state.workspaceVersion : 0) + 1;
            const changedFiles = Array.isArray(payload?.changedFiles) ? payload.changedFiles : [];
            if (changedFiles.length > 0) {
                window.dispatchEvent(new CustomEvent(FILE_EXP_REPLACE_COMPLETE_EVENT, {
                    detail: { changedFiles }
                }));
            }
            this.applyOptimisticResultsAfterReplace({
                selectedOnly,
                selectedIds,
                changedFiles,
                replacements
            });
            if (changedFiles.length > 0) {
                await this.refreshSearchInFilesForPaths(changedFiles);
            }
            this.renderSearchInFilesResults();
            this.updateReplaceButtons();
        } catch (error) {
            console.error("replace_text failed", error);
            this.state.replaceInFilesError = error?.message || "Replace failed.";
        } finally {
            this.state.replaceInFilesLoading = false;
            this.renderReplaceStatus();
            this.updateReplaceButtons();
        }
    }
};
