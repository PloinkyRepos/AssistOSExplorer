import { normalizePath } from "../../pages/file-exp/file-exp-utils.js";
import { callExplorerTool } from "../../../services/infrastructure/explorerApi.js";
import { createTimedCache } from "../../utils/timed-cache.js";
import {
    highlightSearchPreview,
    parsePositiveLineValue
} from "../../utils/workspace-search-utils.js";
import { fileSearchModalSearchMethods } from "./file-search-modal-search.js";
import { fileSearchModalReplaceMethods } from "./file-search-modal-replace.js";

const SEARCH_RESULTS_FILE_BATCH = 20;
const SEARCH_RESULTS_MATCH_BATCH = 40;
const SEARCH_RESULTS_AUTO_EXPAND_THRESHOLD_PX = 140;
const SEARCH_RESULTS_AUTO_EXPAND_COOLDOWN_MS = 140;
const SEARCH_IN_FILES_CACHE_TTL_MS = 5000;
const SEARCH_IN_FILES_CACHE_MAX_ENTRIES = 50;
const SEARCH_REQUEST_TIMEOUT_MS = 15000;
const REPLACE_REQUEST_TIMEOUT_MS = 30000;

export class FileSearchModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.defaultExclude = 'node_modules,.git';
        this.searchInFilesCacheTtlMs = SEARCH_IN_FILES_CACHE_TTL_MS;
        this.searchInFilesCacheMaxEntries = SEARCH_IN_FILES_CACHE_MAX_ENTRIES;
        this.searchInFilesCache = createTimedCache({
            ttlMs: this.searchInFilesCacheTtlMs,
            maxEntries: this.searchInFilesCacheMaxEntries,
            refreshOnGet: true
        });
        this.searchInFilesRequestTimeoutMs = SEARCH_REQUEST_TIMEOUT_MS;
        this.replaceInFilesRequestTimeoutMs = REPLACE_REQUEST_TIMEOUT_MS;
        this.searchInFilesRequestId = 0;
        this.searchInFilesJobId = null;
        this.searchInFilesPollTimer = null;
        this.searchInFilesFileBatchSize = SEARCH_RESULTS_FILE_BATCH;
        this.searchInFilesMatchBatchSize = SEARCH_RESULTS_MATCH_BATCH;
        this.searchResultsAutoExpandThresholdPx = SEARCH_RESULTS_AUTO_EXPAND_THRESHOLD_PX;
        this.searchResultsAutoExpandCooldownMs = SEARCH_RESULTS_AUTO_EXPAND_COOLDOWN_MS;
        this.searchResultsLastAutoExpandAt = 0;
        this.boundHandleInFilesResultsScroll = this.handleInFilesResultsScroll.bind(this);
        this.state = {
            mode: props.mode || 'name',
            basePath: props.basePath || '/',
            searchInFilesBasePath: props.searchInFilesBasePath || '/',
            searchByNameQuery: props.searchByNameQuery || '',
            searchByNameExclude: props.searchByNameExclude || this.defaultExclude,
            searchByNameResults: [],
            searchByNameLoading: false,
            searchByNameError: null,
            searchInFilesQuery: props.searchInFilesQuery || '',
            searchInFilesExclude: props.searchInFilesExclude || this.defaultExclude,
            searchInFilesCase: Boolean(props.searchInFilesCase),
            searchInFilesRegex: Boolean(props.searchInFilesRegex),
            searchInFilesWholeWord: Boolean(props.searchInFilesWholeWord),
            workspaceVersion: Number.isFinite(props.workspaceVersion) ? props.workspaceVersion : 0,
            replaceInFilesWith: props.replaceInFilesWith || '',
            searchInFilesResults: [],
            searchInFilesFileResults: [],
            searchInFilesVisibleFileCount: 0,
            searchInFilesVisibleMatchCounts: {},
            searchInFilesLoading: false,
            searchInFilesRefreshing: false,
            searchInFilesError: null,
            searchInFilesTruncated: false,
            searchInFilesTimedOut: false,
            searchInFilesCacheStats: null,
            replaceInFilesLoading: false,
            replaceInFilesError: null,
            replaceInFilesSummary: null,
            searchByNameTimer: null,
            searchInFilesTimer: null,
            selectedMatchIds: new Set(),
            directorySuggestions: Array.isArray(props.directorySuggestions) ? props.directorySuggestions : []
        };
        this.refreshSearchInFilesCacheStats?.();
        this.invalidate();
    }

    beforeRender() {}

    beforeUnload() {
        this.searchInFilesRequestId += 1;
        this.cancelSearchInFilesJob();
        if (this.state.searchByNameTimer) {
            clearTimeout(this.state.searchByNameTimer);
            this.state.searchByNameTimer = null;
        }
        if (this.state.searchInFilesTimer) {
            clearTimeout(this.state.searchInFilesTimer);
            this.state.searchInFilesTimer = null;
        }
        const inFilesResults = this.element?.querySelector('#searchInFilesResults');
        if (inFilesResults) {
            inFilesResults.removeEventListener('scroll', this.boundHandleInFilesResultsScroll);
        }
    }

    async callTool(agentName, toolName, args) {
        if (agentName !== 'explorer') {
            throw new Error(`Unsupported agent for FileSearchModal: ${agentName}`);
        }
        return callExplorerTool(toolName, args, { raw: true, withLoader: false });
    }

    normalizeBasePath(value) {
        const trimmed = String(value || '').trim();
        return normalizePath(trimmed || '/');
    }

    resolveSearchBasePath() {
        const value = this.state.searchInFilesBasePath || '/';
        return this.normalizeBasePath(value || '/');
    }

    getVisibleSearchInFilesCount(totalFiles) {
        if (totalFiles <= 0) return 0;
        const configured = Number.parseInt(String(this.state.searchInFilesVisibleFileCount ?? ''), 10);
        const fallback = Math.min(totalFiles, this.searchInFilesFileBatchSize);
        if (!Number.isFinite(configured) || configured <= 0) {
            return fallback;
        }
        return Math.min(totalFiles, configured);
    }

    getVisibleMatchesForFile(filePath, totalMatches) {
        if (!filePath || totalMatches <= 0) return 0;
        const counts = this.state.searchInFilesVisibleMatchCounts || {};
        const configured = Number.parseInt(String(counts[filePath] ?? ''), 10);
        const fallback = Math.min(totalMatches, this.searchInFilesMatchBatchSize);
        if (!Number.isFinite(configured) || configured <= 0) {
            return fallback;
        }
        return Math.min(totalMatches, configured);
    }

    resetSearchInFilesProgressiveWindow() {
        const files = Array.isArray(this.state.searchInFilesFileResults) ? this.state.searchInFilesFileResults : [];
        const visibleFileCount = Math.min(files.length, this.searchInFilesFileBatchSize);
        const visibleMatchCounts = {};
        for (let index = 0; index < visibleFileCount; index += 1) {
            const item = files[index];
            if (!item?.path) continue;
            const totalMatches = Array.isArray(item.matches) ? item.matches.length : 0;
            visibleMatchCounts[item.path] = Math.min(totalMatches, this.searchInFilesMatchBatchSize);
        }
        this.state.searchInFilesVisibleFileCount = visibleFileCount;
        this.state.searchInFilesVisibleMatchCounts = visibleMatchCounts;
        this.searchResultsLastAutoExpandAt = 0;
    }

    loadMoreSearchInFilesFiles(step = this.searchInFilesFileBatchSize) {
        const files = Array.isArray(this.state.searchInFilesFileResults) ? this.state.searchInFilesFileResults : [];
        if (!files.length) return false;
        const currentCount = this.getVisibleSearchInFilesCount(files.length);
        if (currentCount >= files.length) return false;
        const nextCount = Math.min(files.length, currentCount + Math.max(1, Number(step) || 1));
        const nextVisibleMatchCounts = { ...(this.state.searchInFilesVisibleMatchCounts || {}) };
        for (let index = currentCount; index < nextCount; index += 1) {
            const fileItem = files[index];
            if (!fileItem?.path) continue;
            const totalMatches = Array.isArray(fileItem.matches) ? fileItem.matches.length : 0;
            const existing = Number.parseInt(String(nextVisibleMatchCounts[fileItem.path] ?? ''), 10);
            if (!Number.isFinite(existing) || existing <= 0) {
                nextVisibleMatchCounts[fileItem.path] = Math.min(totalMatches, this.searchInFilesMatchBatchSize);
            }
        }
        this.state.searchInFilesVisibleFileCount = nextCount;
        this.state.searchInFilesVisibleMatchCounts = nextVisibleMatchCounts;
        this.renderSearchInFilesResults();
        return true;
    }

    loadMoreSearchInFileMatches(filePath, step = this.searchInFilesMatchBatchSize) {
        if (!filePath) return false;
        const files = Array.isArray(this.state.searchInFilesFileResults) ? this.state.searchInFilesFileResults : [];
        const fileItem = files.find((item) => item?.path === filePath);
        if (!fileItem) return false;
        const totalMatches = Array.isArray(fileItem.matches) ? fileItem.matches.length : 0;
        if (!totalMatches) return false;
        const nextVisibleMatchCounts = { ...(this.state.searchInFilesVisibleMatchCounts || {}) };
        const currentCount = this.getVisibleMatchesForFile(filePath, totalMatches);
        if (currentCount >= totalMatches) return false;
        nextVisibleMatchCounts[filePath] = Math.min(
            totalMatches,
            currentCount + Math.max(1, Number(step) || 1)
        );
        this.state.searchInFilesVisibleMatchCounts = nextVisibleMatchCounts;
        this.renderSearchInFilesResults();
        return true;
    }

    handleInFilesResultsScroll() {
        if (this.state.mode !== 'replace') return;
        if (this.state.searchInFilesLoading) return;
        if (this.state.searchInFilesRefreshing) return;
        const container = this.element?.querySelector('#searchInFilesResults');
        if (!container) return;
        const remaining = container.scrollHeight - (container.scrollTop + container.clientHeight);
        if (remaining > this.searchResultsAutoExpandThresholdPx) return;
        this.autoExpandSearchInFilesResults();
    }

    autoExpandSearchInFilesResults() {
        const now = Date.now();
        if ((now - this.searchResultsLastAutoExpandAt) < this.searchResultsAutoExpandCooldownMs) {
            return;
        }
        const files = Array.isArray(this.state.searchInFilesFileResults) ? this.state.searchInFilesFileResults : [];
        if (!files.length) return;
        const visibleFileCount = this.getVisibleSearchInFilesCount(files.length);
        const visibleFiles = files.slice(0, visibleFileCount);
        let expanded = false;
        for (let index = visibleFiles.length - 1; index >= 0; index -= 1) {
            const item = visibleFiles[index];
            const totalMatches = Array.isArray(item?.matches) ? item.matches.length : 0;
            if (!item?.path || totalMatches <= 0) continue;
            const visibleMatches = this.getVisibleMatchesForFile(item.path, totalMatches);
            if (visibleMatches < totalMatches) {
                expanded = this.loadMoreSearchInFileMatches(item.path);
                break;
            }
        }
        if (!expanded) {
            expanded = this.loadMoreSearchInFilesFiles();
        }
        if (expanded) {
            this.searchResultsLastAutoExpandAt = now;
        }
    }

    afterRender() {
        this.syncUIFromState();
        this.bindEvents();
        this.runInitialSearch();
        this.ensureDialogResizable();
    }

    getEventTargetElement(event) {
        const target = event?.target;
        if (target instanceof Element) return target;
        if (target?.parentElement instanceof Element) return target.parentElement;
        return null;
    }

    bindEvents() {
        const {
            mode
        } = this.state;

        const searchByNameInput = this.element.querySelector('#searchByNameInput');
        if (searchByNameInput && !searchByNameInput.dataset.bound) {
            searchByNameInput.addEventListener('input', (e) => {
                this.state.searchByNameQuery = e.target.value;
                this.scheduleSearchByName();
            });
            searchByNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.runSearchByName();
                }
            });
            searchByNameInput.dataset.bound = 'true';
        }

        const searchByNameExclude = this.element.querySelector('#searchByNameExclude');
        if (searchByNameExclude && !searchByNameExclude.dataset.bound) {
            searchByNameExclude.addEventListener('change', (e) => {
                this.state.searchByNameExclude = e.target.value || this.defaultExclude;
                this.scheduleSearchByName();
            });
            searchByNameExclude.dataset.bound = 'true';
        }

        const searchInFilesQuery = this.element.querySelector('#searchInFilesQuery');
        if (searchInFilesQuery && !searchInFilesQuery.dataset.bound) {
            searchInFilesQuery.addEventListener('input', (e) => {
                this.state.searchInFilesQuery = e.target.value;
                this.scheduleSearchInFiles();
            });
            searchInFilesQuery.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.runSearchInFiles();
                }
            });
            searchInFilesQuery.dataset.bound = 'true';
        }

        const searchInFilesExclude = this.element.querySelector('#searchInFilesExclude');
        if (searchInFilesExclude && !searchInFilesExclude.dataset.bound) {
            searchInFilesExclude.addEventListener('change', (e) => {
                this.state.searchInFilesExclude = e.target.value || this.defaultExclude;
                this.scheduleSearchInFiles();
            });
            searchInFilesExclude.dataset.bound = 'true';
        }

        const searchInFilesCase = this.element.querySelector('#searchInFilesCase');
        if (searchInFilesCase && !searchInFilesCase.dataset.bound) {
            searchInFilesCase.addEventListener('change', (e) => {
                this.state.searchInFilesCase = Boolean(e.target.checked);
                this.scheduleSearchInFiles();
            });
            searchInFilesCase.dataset.bound = 'true';
        }

        const searchInFilesRegex = this.element.querySelector('#searchInFilesRegex');
        if (searchInFilesRegex && !searchInFilesRegex.dataset.bound) {
            searchInFilesRegex.addEventListener('change', (e) => {
                this.state.searchInFilesRegex = Boolean(e.target.checked);
                this.scheduleSearchInFiles();
            });
            searchInFilesRegex.dataset.bound = 'true';
        }

        const searchInFilesWholeWord = this.element.querySelector('#searchInFilesWholeWord');
        if (searchInFilesWholeWord && !searchInFilesWholeWord.dataset.bound) {
            searchInFilesWholeWord.addEventListener('change', (e) => {
                this.state.searchInFilesWholeWord = Boolean(e.target.checked);
                this.scheduleSearchInFiles();
            });
            searchInFilesWholeWord.dataset.bound = 'true';
        }

        const searchInFilesBasePath = this.element.querySelector('#searchInFilesBasePath');
        if (searchInFilesBasePath && !searchInFilesBasePath.dataset.bound) {
            searchInFilesBasePath.addEventListener('input', (e) => {
                this.state.searchInFilesBasePath = e.target.value;
                this.updateBasePathSuggestions();
                this.scheduleSearchInFiles();
            });
            searchInFilesBasePath.dataset.bound = 'true';
        }

        const replaceInFilesWith = this.element.querySelector('#replaceInFilesWith');
        if (replaceInFilesWith && !replaceInFilesWith.dataset.bound) {
            replaceInFilesWith.addEventListener('input', (e) => {
                this.state.replaceInFilesWith = e.target.value;
                this.state.replaceInFilesError = null;
                this.state.replaceInFilesSummary = null;
                this.renderReplaceStatus();
                this.updateReplaceButtons();
            });
            replaceInFilesWith.dataset.bound = 'true';
        }

        const byNameResults = this.element.querySelector('#searchByNameResults');
        if (byNameResults && !byNameResults.dataset.boundClick) {
            byNameResults.addEventListener('click', (event) => {
                const targetEl = this.getEventTargetElement(event);
                if (!targetEl) return;
                const target = targetEl.closest('.search-result-item');
                if (target?.dataset?.filePath) {
                    const line = parsePositiveLineValue(target.dataset.line);
                    this.closeModal({ path: target.dataset.filePath, line });
                }
            });
            byNameResults.dataset.boundClick = 'true';
        }

        const inFilesResults = this.element.querySelector('#searchInFilesResults');
        if (inFilesResults && !inFilesResults.dataset.boundClick) {
            inFilesResults.addEventListener('click', (event) => {
                const targetEl = this.getEventTargetElement(event);
                if (!targetEl) return;
                const loadMoreButton = targetEl.closest('.search-load-more-button');
                if (loadMoreButton) {
                    const action = loadMoreButton.dataset.searchAction;
                    if (action === 'load-more-files') {
                        this.loadMoreSearchInFilesFiles();
                    } else if (action === 'load-more-file-matches') {
                        this.loadMoreSearchInFileMatches(loadMoreButton.dataset.filePath);
                    }
                    return;
                }
                if (targetEl.closest('input[type="checkbox"]') || targetEl.closest('label.search-checkbox')) {
                    return;
                }
                const target = targetEl.closest('.search-match-item');
                if (target?.dataset?.filePath) {
                    const line = parsePositiveLineValue(target.dataset.line);
                    this.closeModal({ path: target.dataset.filePath, line });
                }
            });
            inFilesResults.addEventListener('change', (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement)) return;
                const action = target.dataset.toggle;
                if (action === 'toggle-all') {
                    this.toggleAllMatches(Boolean(target.checked));
                    return;
                }
                if (action === 'toggle-file') {
                    const filePath = target.dataset.filePath;
                    if (filePath) {
                        this.toggleFileMatches(filePath, Boolean(target.checked));
                    }
                    return;
                }
                if (action === 'toggle-match') {
                    const matchId = target.dataset.matchId;
                    if (matchId) {
                        this.toggleMatch(matchId, Boolean(target.checked));
                    }
                }
            });
            inFilesResults.dataset.boundClick = 'true';
        }
        if (inFilesResults && !inFilesResults.dataset.boundScroll) {
            inFilesResults.addEventListener('scroll', this.boundHandleInFilesResultsScroll, { passive: true });
            inFilesResults.dataset.boundScroll = 'true';
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

        // Ensure correct overlay is visible based on initial mode
        this.setMode(mode);
    }

    setMode(mode) {
        const nextMode = mode === 'in-files' ? 'replace' : mode;
        this.state.mode = nextMode;
        const nameOverlay = this.element.querySelector('#searchByNameOverlay');
        const textOverlay = this.element.querySelector('#searchInFilesOverlay');
        if (nameOverlay) {
            nameOverlay.classList.toggle('open', nextMode === 'name');
            nameOverlay.setAttribute('aria-hidden', nextMode === 'name' ? 'false' : 'true');
        }
        if (textOverlay) {
            const isTextMode = nextMode === 'replace';
            textOverlay.classList.toggle('open', isTextMode);
            textOverlay.classList.toggle('replace-mode', nextMode === 'replace');
            textOverlay.setAttribute('aria-hidden', isTextMode ? 'false' : 'true');
        }
    }

    setSearchMode(_target, mode) {
        if (!mode) return;
        this.setMode(mode);
        this.syncUIFromState();
        if (this.state.mode === 'replace') {
            this.runSearchInFiles();
        }
    }

    replaceSelected() {
        this.performReplace({ selectedOnly: true });
    }

    replaceAll() {
        this.performReplace({ selectedOnly: false });
    }

    updateBasePathSuggestions() {
        const list = this.element.querySelector('#searchInFilesBasePathList');
        if (!list) return;
        list.innerHTML = '';
        const raw = String(this.state.searchInFilesBasePath || '').trim().toLowerCase();
        const all = Array.isArray(this.state.directorySuggestions) ? this.state.directorySuggestions : [];
        const filtered = raw
            ? all.filter((entry) => entry.toLowerCase().startsWith(raw) || entry.toLowerCase().includes(raw))
            : all;
        filtered.slice(0, 80).forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry;
            list.appendChild(option);
        });
    }

    syncUIFromState() {
        const state = this.state;
        this.setMode(state.mode);
        this.updateModeButtons();
        const setValue = (selector, value) => {
            const el = this.element.querySelector(selector);
            if (el && el.value !== value) {
                el.value = value;
            }
        };

        setValue('#searchByNameInput', state.searchByNameQuery);
        setValue('#searchByNameExclude', state.searchByNameExclude);
        setValue('#searchInFilesQuery', state.searchInFilesQuery);
        setValue('#searchInFilesExclude', state.searchInFilesExclude);
        setValue('#replaceInFilesWith', state.replaceInFilesWith);
        const basePathInput = this.element.querySelector('#searchInFilesBasePath');
        if (basePathInput) {
            basePathInput.value = state.searchInFilesBasePath || '/';
            basePathInput.disabled = false;
        }
        const textCaseInput = this.element.querySelector('#searchInFilesCase');
        if (textCaseInput) {
            textCaseInput.checked = Boolean(state.searchInFilesCase);
        }
        const regexInput = this.element.querySelector('#searchInFilesRegex');
        if (regexInput) {
            regexInput.checked = Boolean(state.searchInFilesRegex);
        }
        const wholeWordInput = this.element.querySelector('#searchInFilesWholeWord');
        if (wholeWordInput) {
            wholeWordInput.checked = Boolean(state.searchInFilesWholeWord);
        }
        this.updateBasePathSuggestions();
        this.renderSearchByNameResults();
        this.renderSearchInFilesResults();
        this.renderReplaceStatus();
        this.updateReplaceButtons();
    }

    updateModeButtons() {
        const buttons = Array.from(this.element.querySelectorAll('.search-mode-switch .mode-button'));
        buttons.forEach((button) => {
            const isActive = button.dataset.mode === this.state.mode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    runInitialSearch() {
        if (this.state.mode === 'name' && this.state.searchByNameQuery.trim().length >= 2) {
            this.runSearchByName();
        }
        if (this.state.mode === 'replace' && this.state.searchInFilesQuery.trim()) {
            // Only kick off if user already had a query
            this.runSearchInFiles();
        }
    }

    renderSearchByNameResults() {
        const container = this.element.querySelector('#searchByNameResults');
        const status = this.element.querySelector('#searchByNameStatus');
        if (!container || !status) {
            return;
        }
        container.innerHTML = '';
        status.className = 'search-status';

        if (this.state.searchByNameLoading) {
            status.textContent = 'Searching...';
            return;
        }
        if (this.state.searchByNameError) {
            status.textContent = this.state.searchByNameError;
            status.classList.add('error');
            return;
        }
        if (!this.state.searchByNameQuery.trim()) {
            status.textContent = 'Type to search for files or folders.';
            return;
        }
        if (!this.state.searchByNameResults.length) {
            status.textContent = 'No matches found.';
            return;
        }

        status.textContent = `${this.state.searchByNameResults.length} match${this.state.searchByNameResults.length === 1 ? '' : 'es'}`;
        this.state.searchByNameResults.forEach((item) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'search-result-item';
            row.dataset.filePath = item.path;
            const name = document.createElement('div');
            name.className = 'search-result-path';
            name.textContent = item.name;
            const preview = document.createElement('div');
            preview.className = 'search-result-preview';
            preview.textContent = item.displayPath;
            row.appendChild(name);
            row.appendChild(preview);
            container.appendChild(row);
        });
    }

    renderSearchInFilesResults() {
        const container = this.element.querySelector('#searchInFilesResults');
        const status = this.element.querySelector('#searchInFilesStatus');
        if (!container || !status) {
            return;
        }
        container.innerHTML = '';
        status.className = 'search-status';

        const files = Array.isArray(this.state.searchInFilesFileResults) ? this.state.searchInFilesFileResults : [];
        const matches = this.state.searchInFilesResults || [];
        const selected = this.state.selectedMatchIds instanceof Set ? this.state.selectedMatchIds : new Set();
        const totalMatches = matches.length;
        const selectedCount = selected.size;
        if (this.state.searchInFilesError) {
            status.textContent = this.state.searchInFilesError;
            status.classList.add('error');
            return;
        }
        if (!this.state.searchInFilesQuery.trim()) {
            status.textContent = 'Search the workspace for text.';
            return;
        }
        if (this.state.searchInFilesLoading && files.length === 0) {
            status.classList.add('loading');
            status.innerHTML = '';
            const spinner = document.createElement('span');
            spinner.className = 'search-spinner';
            const text = document.createElement('span');
            text.textContent = 'Searching across files...';
            status.appendChild(spinner);
            status.appendChild(text);
            return;
        }
        if (this.state.searchInFilesRefreshing && files.length === 0) {
            status.classList.add('loading');
            status.innerHTML = '';
            const spinner = document.createElement('span');
            spinner.className = 'search-spinner';
            const text = document.createElement('span');
            text.textContent = 'Refreshing changed files...';
            status.appendChild(spinner);
            status.appendChild(text);
            return;
        }
        if (!files.length) {
            status.textContent = 'No matches found.';
            return;
        }

        const visibleFileCount = this.getVisibleSearchInFilesCount(files.length);
        const visibleFiles = files.slice(0, visibleFileCount);
        const remainingFiles = Math.max(0, files.length - visibleFiles.length);
        const highlightOptions = {
            query: this.state.searchInFilesQuery,
            useRegex: this.state.searchInFilesRegex,
            wholeWord: this.state.searchInFilesWholeWord,
            caseSensitive: this.state.searchInFilesCase
        };
        const truncatedNote = this.state.searchInFilesTruncated ? ' (truncated)' : '';
        const timedOutNote = this.state.searchInFilesTimedOut ? ' • timed out' : '';
        const refreshingNote = this.state.searchInFilesRefreshing ? ' • refreshing' : '';
        const selectedNote = totalMatches ? ` • ${selectedCount}/${totalMatches} selected` : '';

        const visibilityNote = remainingFiles > 0
            ? ` • showing ${visibleFiles.length}/${files.length} files`
            : '';

        // Show spinner inline when loading with partial results
        if (this.state.searchInFilesLoading || this.state.searchInFilesRefreshing) {
            status.classList.add('loading');
            const loadingText = this.state.searchInFilesRefreshing ? 'refreshing' : 'searching';
            status.innerHTML = `<span class="search-spinner"></span><span>${files.length} file${files.length === 1 ? '' : 's'}, ${totalMatches} match${totalMatches === 1 ? '' : 'es'}${selectedNote}${visibilityNote}${truncatedNote}${timedOutNote} • ${loadingText}...</span>`;
        } else {
            status.textContent = `${files.length} file${files.length === 1 ? '' : 's'}, ${totalMatches} match${totalMatches === 1 ? '' : 'es'}${selectedNote}${visibilityNote}${truncatedNote}${timedOutNote}${refreshingNote}`;
        }

        if (this.state.searchInFilesTruncated) {
            status.classList.add('strong');
        }

        const selectionBar = document.createElement('div');
        selectionBar.className = 'search-selection-bar';
        const selectAllLabel = document.createElement('label');
        selectAllLabel.className = 'search-checkbox';
        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        selectAllCheckbox.dataset.toggle = 'toggle-all';
        selectAllCheckbox.checked = totalMatches > 0 && selectedCount === totalMatches;
        selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalMatches;
        const selectAllText = document.createElement('span');
        selectAllText.textContent = 'Select all matches';
        selectAllLabel.appendChild(selectAllCheckbox);
        selectAllLabel.appendChild(selectAllText);
        selectionBar.appendChild(selectAllLabel);
        container.appendChild(selectionBar);

        visibleFiles.forEach((item) => {
            const fileGroup = document.createElement('div');
            fileGroup.className = 'search-file-group';
            const header = document.createElement('div');
            header.className = 'search-file-header';

            const fileLabel = document.createElement('label');
            fileLabel.className = 'search-checkbox';
            const fileCheckbox = document.createElement('input');
            fileCheckbox.type = 'checkbox';
            fileCheckbox.dataset.toggle = 'toggle-file';
            fileCheckbox.dataset.filePath = item.path;
            const fileMatches = Array.isArray(item.matches) ? item.matches : [];
            const fileSelected = fileMatches.filter((match) => selected.has(match.id)).length;
            fileCheckbox.checked = fileMatches.length > 0 && fileSelected === fileMatches.length;
            fileCheckbox.indeterminate = fileSelected > 0 && fileSelected < fileMatches.length;
            const visibleMatchCount = this.getVisibleMatchesForFile(item.path, fileMatches.length);
            const visibleMatches = fileMatches.slice(0, visibleMatchCount);
            const remainingMatches = Math.max(0, fileMatches.length - visibleMatches.length);

            const pathLabel = document.createElement('div');
            pathLabel.className = 'search-result-path';
            pathLabel.textContent = item.path;
            fileLabel.appendChild(fileCheckbox);
            fileLabel.appendChild(pathLabel);

            const meta = document.createElement('div');
            meta.className = 'search-result-meta';
            meta.textContent = `${item.count} match${item.count === 1 ? '' : 'es'}`;

            header.appendChild(fileLabel);
            header.appendChild(meta);
            fileGroup.appendChild(header);

            const matchList = document.createElement('div');
            matchList.className = 'search-match-list';
            visibleMatches.forEach((match) => {
                const row = document.createElement('div');
                row.className = 'search-match-item';
                row.dataset.filePath = match.path;
                if (match.line) {
                    row.dataset.line = match.line;
                }
                row.dataset.matchId = match.id;

                const checkboxLabel = document.createElement('label');
                checkboxLabel.className = 'search-checkbox';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.dataset.toggle = 'toggle-match';
                checkbox.dataset.matchId = match.id;
                checkbox.dataset.filePath = match.path;
                checkbox.checked = selected.has(match.id);
                checkboxLabel.appendChild(checkbox);

                const info = document.createElement('div');
                info.className = 'search-match-info';
                const metaLine = document.createElement('div');
                metaLine.className = 'search-match-meta';
                if (match.line) {
                    metaLine.textContent = `Line ${match.line}${match.column ? `, Col ${match.column}` : ''}`;
                } else {
                    metaLine.textContent = 'Match';
                }
                const preview = document.createElement('div');
                preview.className = 'search-result-preview';
                preview.innerHTML = highlightSearchPreview(match.preview || '', highlightOptions);
                info.appendChild(metaLine);
                info.appendChild(preview);

                row.appendChild(checkboxLabel);
                row.appendChild(info);
                matchList.appendChild(row);
            });

            if (remainingMatches > 0) {
                const loadMoreRow = document.createElement('div');
                loadMoreRow.className = 'search-load-more-row';
                const loadMoreButton = document.createElement('button');
                loadMoreButton.type = 'button';
                loadMoreButton.className = 'search-load-more-button';
                loadMoreButton.dataset.searchAction = 'load-more-file-matches';
                loadMoreButton.dataset.filePath = item.path;
                const nextChunk = Math.min(this.searchInFilesMatchBatchSize, remainingMatches);
                loadMoreButton.textContent = `Load ${nextChunk} more match${nextChunk === 1 ? '' : 'es'} (${remainingMatches} remaining)`;
                loadMoreRow.appendChild(loadMoreButton);
                matchList.appendChild(loadMoreRow);
            }

            fileGroup.appendChild(matchList);
            container.appendChild(fileGroup);
        });

        if (remainingFiles > 0) {
            const loadMoreFilesRow = document.createElement('div');
            loadMoreFilesRow.className = 'search-load-more-row global';
            const loadMoreFilesButton = document.createElement('button');
            loadMoreFilesButton.type = 'button';
            loadMoreFilesButton.className = 'search-load-more-button';
            loadMoreFilesButton.dataset.searchAction = 'load-more-files';
            const nextFilesChunk = Math.min(this.searchInFilesFileBatchSize, remainingFiles);
            loadMoreFilesButton.textContent = `Load ${nextFilesChunk} more file${nextFilesChunk === 1 ? '' : 's'} (${remainingFiles} remaining)`;
            loadMoreFilesRow.appendChild(loadMoreFilesButton);
            container.appendChild(loadMoreFilesRow);
        }

        if (this.state.mode === 'replace') {
            requestAnimationFrame(() => this.handleInFilesResultsScroll());
        }
    }

    toggleAllMatches(checked) {
        const matches = this.state.searchInFilesResults || [];
        if (checked) {
            this.state.selectedMatchIds = new Set(matches.map((item) => item.id));
        } else {
            this.state.selectedMatchIds = new Set();
        }
        this.renderSearchInFilesResults();
        this.updateReplaceButtons();
    }

    toggleFileMatches(filePath, checked) {
        const selected = this.state.selectedMatchIds instanceof Set ? new Set(this.state.selectedMatchIds) : new Set();
        const matches = (this.state.searchInFilesResults || []).filter((item) => item.path === filePath);
        matches.forEach((item) => {
            if (checked) {
                selected.add(item.id);
            } else {
                selected.delete(item.id);
            }
        });
        this.state.selectedMatchIds = selected;
        this.renderSearchInFilesResults();
        this.updateReplaceButtons();
    }

    toggleMatch(matchId, checked) {
        const selected = this.state.selectedMatchIds instanceof Set ? new Set(this.state.selectedMatchIds) : new Set();
        if (checked) {
            selected.add(matchId);
        } else {
            selected.delete(matchId);
        }
        this.state.selectedMatchIds = selected;
        this.renderSearchInFilesResults();
        this.updateReplaceButtons();
    }

    updateReplaceButtons() {
        const replaceSelectedButton = this.element.querySelector('#replaceSelectedButton');
        const replaceAllButton = this.element.querySelector('#replaceAllButton');
        if (!replaceSelectedButton && !replaceAllButton) return;
        const query = (this.state.searchInFilesQuery || '').trim();
        const hasMatches = Array.isArray(this.state.searchInFilesResults) && this.state.searchInFilesResults.length > 0;
        const selectedCount = this.state.selectedMatchIds instanceof Set ? this.state.selectedMatchIds.size : 0;
        const busy = Boolean(this.state.replaceInFilesLoading)
            || Boolean(this.state.searchInFilesLoading)
            || Boolean(this.state.searchInFilesRefreshing);
        if (replaceSelectedButton) {
            replaceSelectedButton.disabled = busy || !query || !hasMatches || selectedCount === 0;
        }
        if (replaceAllButton) {
            replaceAllButton.disabled = busy || !query || !hasMatches;
        }
    }

    renderReplaceStatus() {
        const status = this.element.querySelector('#replaceInFilesStatus');
        if (!status) return;
        status.className = 'replace-status';
        status.textContent = '';
        if (this.state.replaceInFilesLoading) {
            status.textContent = 'Replacing...';
            return;
        }
        if (this.state.replaceInFilesError) {
            status.textContent = this.state.replaceInFilesError;
            status.classList.add('error');
            return;
        }
        if (this.state.replaceInFilesSummary) {
            status.textContent = this.state.replaceInFilesSummary;
        }
    }

    buildClosePayload(payload = {}) {
        const basePayload = payload && typeof payload === 'object' ? { ...payload } : {};
        basePayload.searchByNameQuery = String(this.state.searchByNameQuery || '');
        basePayload.searchByNameExclude = String(this.state.searchByNameExclude || this.defaultExclude);
        basePayload.searchInFilesQuery = String(this.state.searchInFilesQuery || '');
        basePayload.searchInFilesExclude = String(this.state.searchInFilesExclude || this.defaultExclude);
        basePayload.searchInFilesCase = Boolean(this.state.searchInFilesCase);
        basePayload.searchInFilesCaseSensitive = Boolean(this.state.searchInFilesCase);
        basePayload.searchInFilesRegex = Boolean(this.state.searchInFilesRegex);
        basePayload.searchInFilesWholeWord = Boolean(this.state.searchInFilesWholeWord);
        basePayload.searchInFilesBasePath = this.resolveSearchBasePath();
        basePayload.workspaceVersion = Number.isFinite(this.state.workspaceVersion) ? this.state.workspaceVersion : 0;
        return basePayload;
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, this.buildClosePayload(payload));
    }

    getDialogElement() {
        return this.element?.closest?.('dialog') || null;
    }

    ensureDialogPositioning() {
        const dialog = this.getDialogElement();
        if (!dialog) return null;
        if (dialog.dataset.fileSearchPositioned === 'true') return dialog;
        const rect = dialog.getBoundingClientRect();
        dialog.style.left = `${rect.left}px`;
        dialog.style.top = `${rect.top}px`;
        dialog.classList.add('file-search-positioned');
        dialog.dataset.fileSearchPositioned = 'true';
        dialog.dataset.fileSearchUserSized = 'false';
        return dialog;
    }

    startResize(event, dir) {
        const dialog = this.ensureDialogPositioning();
        if (!dialog) return;
        if (dialog.classList.contains('is-fullscreen')) return;

        event.preventDefault();
        event.stopPropagation();

        const startRect = dialog.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const minW = 760;
        const minH = 520;

        const onMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let left = startRect.left;
            let top = startRect.top;
            let width = startRect.width;
            let height = startRect.height;

            if (dir.includes('e')) width = startRect.width + dx;
            if (dir.includes('s')) height = startRect.height + dy;
            if (dir.includes('w')) {
                width = startRect.width - dx;
                left = startRect.left + dx;
            }
            if (dir.includes('n')) {
                height = startRect.height - dy;
                top = startRect.top + dy;
            }

            width = Math.max(minW, width);
            height = Math.max(minH, height);

            if (dir.includes('w') && width === minW) {
                left = startRect.right - minW;
            }
            if (dir.includes('n') && height === minH) {
                top = startRect.bottom - minH;
            }

            dialog.style.left = `${left}px`;
            dialog.style.top = `${top}px`;
            dialog.style.width = `${width}px`;
            dialog.style.height = `${height}px`;
            dialog.dataset.fileSearchUserSized = 'true';
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
        };

        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
    }

    ensureDialogResizable() {
        const dialog = this.getDialogElement();
        if (!dialog) return;
        if (dialog.dataset.fileSearchResizable === 'true') return;

        const host = this.element.querySelector('.search-modal') || this.element;
        const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
        for (const dir of handles) {
            const handle = document.createElement('div');
            handle.className = `file-search-resize-handle ${dir}`;
            handle.dataset.dir = dir;
            handle.addEventListener('pointerdown', (event) => this.startResize(event, dir));
            host.appendChild(handle);
        }
        dialog.dataset.fileSearchResizable = 'true';
    }

    toggleFullscreen() {
        const dialog = this.ensureDialogPositioning();
        if (!dialog) return;

        const isNowFullscreen = !dialog.classList.contains('is-fullscreen');
        if (isNowFullscreen) {
            const rect = dialog.getBoundingClientRect();
            this._dialogPrevState = {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                userSized: dialog.dataset.fileSearchUserSized === 'true'
            };
            dialog.classList.add('is-fullscreen');
            return;
        }

        dialog.classList.remove('is-fullscreen');
        const prev = this._dialogPrevState;
        if (prev) {
            dialog.style.left = `${prev.left}px`;
            dialog.style.top = `${prev.top}px`;
            if (prev.userSized) {
                dialog.style.width = `${prev.width}px`;
                dialog.style.height = `${prev.height}px`;
                dialog.dataset.fileSearchUserSized = 'true';
            } else {
                dialog.style.removeProperty('width');
                dialog.style.removeProperty('height');
                dialog.dataset.fileSearchUserSized = 'false';
            }
        }
    }
}

Object.assign(
    FileSearchModal.prototype,
    fileSearchModalSearchMethods,
    fileSearchModalReplaceMethods
);
