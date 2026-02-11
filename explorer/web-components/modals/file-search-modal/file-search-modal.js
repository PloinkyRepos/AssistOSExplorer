import { normalizePath, parsePatterns } from "../../pages/file-exp/file-exp-utils.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";
import { FILE_EXP_REPLACE_COMPLETE_EVENT } from "../../../utils/appEvents.js";
import { callExplorerTool } from "../../../services/infrastructure/explorerApi.js";

export class FileSearchModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.defaultExclude = 'node_modules,.git';
        this.searchInFilesCache = new Map();
        this.searchInFilesCacheTtlMs = 5000;
        this.searchInFilesRequestId = 0;
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
            replaceInFilesWith: props.replaceInFilesWith || '',
            searchInFilesResults: [],
            searchInFilesFileResults: [],
            searchInFilesLoading: false,
            searchInFilesError: null,
            searchInFilesTruncated: false,
            replaceInFilesLoading: false,
            replaceInFilesError: null,
            replaceInFilesSummary: null,
            searchByNameTimer: null,
            searchInFilesTimer: null,
            selectedMatchIds: new Set(),
            directorySuggestions: Array.isArray(props.directorySuggestions) ? props.directorySuggestions : []
        };
        this.invalidate();
    }

    beforeRender() {}

    async callTool(agentName, toolName, args) {
        if (agentName !== 'explorer') {
            throw new Error(`Unsupported agent for FileSearchModal: ${agentName}`);
        }
        return callExplorerTool(toolName, args, { raw: true });
    }

    normalizeBasePath(value) {
        const trimmed = String(value || '').trim();
        return normalizePath(trimmed || '/');
    }

    resolveSearchBasePath() {
        const value = this.state.searchInFilesBasePath || '/';
        return this.normalizeBasePath(value || '/');
    }

    afterRender() {
        this.syncUIFromState();
        this.bindEvents();
        this.runInitialSearch();
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeRegExp(value) {
        return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    buildHighlightRegex() {
        const query = String(this.state.searchInFilesQuery || '').trim();
        if (!query) return null;
        const useRegex = Boolean(this.state.searchInFilesRegex);
        const wholeWord = Boolean(this.state.searchInFilesWholeWord);
        const caseSensitive = Boolean(this.state.searchInFilesCase);
        let pattern = useRegex ? query : this.escapeRegExp(query);
        if (wholeWord) {
            pattern = `\\b(?:${pattern})\\b`;
        }
        const flags = caseSensitive ? 'g' : 'gi';
        try {
            return new RegExp(pattern, flags);
        } catch (_) {
            return null;
        }
    }

    highlightPreview(text) {
        const value = String(text ?? '');
        if (!value) return '';
        const regex = this.buildHighlightRegex();
        if (!regex) return this.escapeHtml(value);
        regex.lastIndex = 0;
        const firstMatch = regex.exec(value);
        if (!firstMatch) {
            return this.escapeHtml(value);
        }

        const matchText = firstMatch[0] ?? '';
        const matchIndex = Number.isFinite(firstMatch.index) ? firstMatch.index : 0;
        const contextBefore = 60;
        const contextAfter = 50;
        const start = Math.max(0, matchIndex - contextBefore);
        const end = Math.min(value.length, matchIndex + matchText.length + contextAfter);
        const snippet = value.slice(start, end);
        const prefix = start > 0 ? '…' : '';
        const suffix = end < value.length ? '…' : '';

        regex.lastIndex = 0;
        let lastIndex = 0;
        let result = '';
        let match;
        while ((match = regex.exec(snippet)) !== null) {
            const textMatch = match[0] ?? '';
            const localStart = Number.isFinite(match.index) ? match.index : 0;
            const localEnd = localStart + textMatch.length;
            result += this.escapeHtml(snippet.slice(lastIndex, localStart));
            result += `<mark class="search-highlight">${this.escapeHtml(snippet.slice(localStart, localEnd))}</mark>`;
            lastIndex = localEnd;
            if (textMatch.length === 0) {
                regex.lastIndex = localStart + 1;
            }
        }
        result += this.escapeHtml(snippet.slice(lastIndex));
        return `${prefix}${result}${suffix}`;
    }

    getEventTargetElement(event) {
        const target = event?.target;
        if (target instanceof Element) return target;
        if (target?.parentElement instanceof Element) return target.parentElement;
        return null;
    }

    parseLineValue(value) {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

        const replaceSelectedButton = this.element.querySelector('#replaceSelectedButton');
        if (replaceSelectedButton && !replaceSelectedButton.dataset.bound) {
            replaceSelectedButton.addEventListener('click', () => this.performReplace({ selectedOnly: true }));
            replaceSelectedButton.dataset.bound = 'true';
        }

        const replaceAllButton = this.element.querySelector('#replaceAllButton');
        if (replaceAllButton && !replaceAllButton.dataset.bound) {
            replaceAllButton.addEventListener('click', () => this.performReplace({ selectedOnly: false }));
            replaceAllButton.dataset.bound = 'true';
        }

        const closeButton = this.element.querySelector('#searchModalClose');
        if (closeButton && !closeButton.dataset.bound) {
            closeButton.addEventListener('click', () => this.closeModal());
            closeButton.dataset.bound = 'true';
        }

        const modeSwitch = this.element.querySelector('.search-mode-switch');
        if (modeSwitch && !modeSwitch.dataset.bound) {
            modeSwitch.addEventListener('click', (event) => {
                const targetEl = this.getEventTargetElement(event);
                if (!targetEl) return;
                const button = targetEl.closest('.mode-button');
                if (!button?.dataset?.mode) return;
                this.setMode(button.dataset.mode);
                this.syncUIFromState();
                if (this.state.mode === 'replace') {
                    this.runSearchInFiles();
                }
            });
            modeSwitch.dataset.bound = 'true';
        }

        const byNameResults = this.element.querySelector('#searchByNameResults');
        if (byNameResults && !byNameResults.dataset.boundClick) {
            byNameResults.addEventListener('click', (event) => {
                const targetEl = this.getEventTargetElement(event);
                if (!targetEl) return;
                const target = targetEl.closest('.search-result-item');
                if (target?.dataset?.filePath) {
                    const line = this.parseLineValue(target.dataset.line);
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
                if (targetEl.closest('input[type="checkbox"]') || targetEl.closest('label.search-checkbox')) {
                    return;
                }
                const target = targetEl.closest('.search-match-item');
                if (target?.dataset?.filePath) {
                    const line = this.parseLineValue(target.dataset.line);
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

    scheduleSearchByName() {
        if (this.state.searchByNameTimer) {
            clearTimeout(this.state.searchByNameTimer);
        }
        this.state.searchByNameTimer = setTimeout(() => this.runSearchByName(), 200);
    }

    scheduleSearchInFiles() {
        if (this.state.searchInFilesTimer) {
            clearTimeout(this.state.searchInFilesTimer);
        }
        this.state.replaceInFilesError = null;
        this.state.replaceInFilesSummary = null;
        this.renderReplaceStatus();
        const query = (this.state.searchInFilesQuery || '').trim();
        if (!query) {
            this.searchInFilesRequestId += 1;
            this.state.searchInFilesLoading = false;
            this.state.searchInFilesError = 'Enter text to search for.';
            this.state.searchInFilesResults = [];
            this.state.searchInFilesFileResults = [];
            this.state.searchInFilesTruncated = false;
            this.state.selectedMatchIds = new Set();
            this.renderSearchInFilesResults();
            return;
        }
        this.state.searchInFilesTimer = setTimeout(() => this.runSearchInFiles(), 200);
    }

    buildSearchInFilesCacheKey() {
        const basePath = this.resolveSearchBasePath();
        const query = (this.state.searchInFilesQuery || '').trim();
        const exclude = this.state.searchInFilesExclude || this.defaultExclude;
        const caseSensitive = Boolean(this.state.searchInFilesCase);
        const useRegex = Boolean(this.state.searchInFilesRegex);
        const wholeWord = Boolean(this.state.searchInFilesWholeWord);
        return JSON.stringify({ basePath, query, exclude, caseSensitive, useRegex, wholeWord });
    }

    getCachedSearchInFilesResult(key) {
        const entry = this.searchInFilesCache.get(key);
        if (!entry) return null;
        if ((Date.now() - entry.cachedAt) > this.searchInFilesCacheTtlMs) {
            this.searchInFilesCache.delete(key);
            return null;
        }
        return entry.value;
    }

    setCachedSearchInFilesResult(key, value) {
        this.searchInFilesCache.set(key, { cachedAt: Date.now(), value });
        // keep cache small
        if (this.searchInFilesCache.size > 50) {
            const firstKey = this.searchInFilesCache.keys().next().value;
            this.searchInFilesCache.delete(firstKey);
        }
    }

    async runSearchByName() {
        const query = (this.state.searchByNameQuery || '').trim();
        if (!query) {
            this.state.searchByNameResults = [];
            this.state.searchByNameError = null;
            this.renderSearchByNameResults();
            return;
        }
        if (query.length < 2) {
            this.state.searchByNameResults = [];
            this.state.searchByNameError = 'Type at least 2 characters.';
            this.renderSearchByNameResults();
            return;
        }
            this.state.searchByNameLoading = true;
            this.state.searchByNameError = null;
            this.renderSearchByNameResults();
        try {
            const excludePatterns = parsePatterns(this.state.searchByNameExclude);
            const result = await this.callTool('explorer', 'search_files', {
                path: this.state.basePath || '/',
                pattern: query,
                excludePatterns
            });
            const lines = (result.text || '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.toLowerCase().includes('no matches'));
            const items = lines.map((line) => {
                const normalized = normalizePath(line.startsWith('/') ? line : `/${line}`);
                const name = normalized.split('/').pop() || '/';
                return {
                    path: normalized,
                    name,
                    displayPath: normalized
                };
            });
            this.state.searchByNameResults = items;
        } catch (error) {
            console.error('search_files failed', error);
            this.state.searchByNameError = error?.message || 'Search failed.';
            this.state.searchByNameResults = [];
        } finally {
            this.state.searchByNameLoading = false;
            this.renderSearchByNameResults();
        }
    }

    async runSearchInFiles() {
        const query = (this.state.searchInFilesQuery || '').trim();
        if (!query) {
            this.state.searchInFilesResults = [];
            this.state.searchInFilesError = 'Enter text to search for.';
            this.state.searchInFilesFileResults = [];
            this.state.selectedMatchIds = new Set();
            this.renderSearchInFilesResults();
            return;
        }
        const requestId = ++this.searchInFilesRequestId;
            this.state.searchInFilesLoading = true;
            this.state.searchInFilesError = null;
            this.state.searchInFilesTruncated = false;
            this.renderSearchInFilesResults();
        try {
            const cacheKey = this.buildSearchInFilesCacheKey();
            const cached = this.getCachedSearchInFilesResult(cacheKey);
            if (cached) {
                this.state.searchInFilesResults = cached.matches || [];
                this.state.searchInFilesFileResults = this.groupMatchesByFileDetailed(this.state.searchInFilesResults);
                this.state.selectedMatchIds = new Set(this.state.searchInFilesResults.map((item) => item.id));
                this.state.searchInFilesTruncated = Boolean(cached.truncated);
                return;
            }

            const excludePatterns = parsePatterns(this.state.searchInFilesExclude);
            const result = await this.callTool('explorer', 'search_text', {
                path: this.resolveSearchBasePath(),
                query,
                caseSensitive: this.state.searchInFilesCase,
                useRegex: this.state.searchInFilesRegex,
                wholeWord: this.state.searchInFilesWholeWord,
                excludePatterns
            });
            if (requestId !== this.searchInFilesRequestId) {
                return;
            }
            let payload = result.json;
            if (!payload) {
                try {
                    payload = JSON.parse(result.text || '{}');
                } catch (_) {
                    payload = null;
                }
            }
            const matches = payload?.results || [];
            this.state.searchInFilesResults = matches.map((match) => {
                const path = match.path ? normalizePath(match.path) : '/';
                const line = match.line || null;
                const column = match.column || null;
                const matchIndex = match.matchIndex ?? 0;
                const id = match.id || `${path}:${line}:${column}:${matchIndex}`;
                return {
                    path,
                    line,
                    column,
                    matchIndex,
                    match: match.match || '',
                    preview: match.preview || '',
                    id
                };
            });
            this.state.searchInFilesFileResults = this.groupMatchesByFileDetailed(this.state.searchInFilesResults);
            this.state.selectedMatchIds = new Set(this.state.searchInFilesResults.map((item) => item.id));
            this.state.searchInFilesTruncated = Boolean(payload?.truncated);
            this.setCachedSearchInFilesResult(this.buildSearchInFilesCacheKey(), {
                matches: this.state.searchInFilesResults,
                truncated: this.state.searchInFilesTruncated
            });
        } catch (error) {
            if (requestId !== this.searchInFilesRequestId) {
                return;
            }
            console.error('search_text failed', error);
            this.state.searchInFilesError = error?.message || 'Search failed.';
            this.state.searchInFilesResults = [];
            this.state.searchInFilesFileResults = [];
            this.state.searchInFilesTruncated = false;
            this.state.selectedMatchIds = new Set();
        } finally {
            if (requestId !== this.searchInFilesRequestId) {
                return;
            }
            this.state.searchInFilesLoading = false;
            this.renderSearchInFilesResults();
            this.updateReplaceButtons();
        }
    }

    groupMatchesByFileDetailed(matches = []) {
        const grouped = new Map();
        matches.forEach((item) => {
            if (!item?.path) return;
            const existing = grouped.get(item.path) || {
                path: item.path,
                count: 0,
                firstLine: null,
                preview: '',
                matches: []
            };
            existing.count += 1;
            if (existing.firstLine === null && item.line) {
                existing.firstLine = item.line;
            }
            if (!existing.preview && item.preview) {
                existing.preview = item.preview;
            }
            existing.matches.push(item);
            grouped.set(item.path, existing);
        });
        return Array.from(grouped.values()).map((entry) => {
            entry.matches.sort((a, b) => {
                const lineDiff = (a.line || 0) - (b.line || 0);
                if (lineDiff !== 0) return lineDiff;
                return (a.column || 0) - (b.column || 0);
            });
            return entry;
        });
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

        const files = this.state.searchInFilesFileResults;
        const matches = this.state.searchInFilesResults || [];
        const selected = this.state.selectedMatchIds instanceof Set ? this.state.selectedMatchIds : new Set();
        const totalMatches = matches.length;
        const selectedCount = selected.size;
        if (this.state.searchInFilesLoading) {
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
        if (this.state.searchInFilesError) {
            status.textContent = this.state.searchInFilesError;
            status.classList.add('error');
            return;
        }
        if (!this.state.searchInFilesQuery.trim()) {
            status.textContent = 'Search the workspace for text.';
            return;
        }
        if (!files.length) {
            status.textContent = 'No matches found.';
            return;
        }

        const truncatedNote = this.state.searchInFilesTruncated ? ' (truncated)' : '';
        const selectedNote = totalMatches ? ` • ${selectedCount}/${totalMatches} selected` : '';
        status.textContent = `${files.length} file${files.length === 1 ? '' : 's'}, ${totalMatches} match${totalMatches === 1 ? '' : 'es'}${truncatedNote}${selectedNote}`;
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

        files.forEach((item) => {
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
            const fileMatches = item.matches || [];
            const fileSelected = fileMatches.filter((match) => selected.has(match.id)).length;
            fileCheckbox.checked = fileMatches.length > 0 && fileSelected === fileMatches.length;
            fileCheckbox.indeterminate = fileSelected > 0 && fileSelected < fileMatches.length;

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
            fileMatches.forEach((match) => {
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
                preview.innerHTML = this.highlightPreview(match.preview || '');
                info.appendChild(metaLine);
                info.appendChild(preview);

                row.appendChild(checkboxLabel);
                row.appendChild(info);
                matchList.appendChild(row);
            });

            fileGroup.appendChild(matchList);
            container.appendChild(fileGroup);
        });
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
        const busy = Boolean(this.state.replaceInFilesLoading) || Boolean(this.state.searchInFilesLoading);
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

    async performReplace({ selectedOnly }) {
        if (this.state.replaceInFilesLoading) return;
        const query = (this.state.searchInFilesQuery || '').trim();
        if (!query) {
            this.state.replaceInFilesError = 'Enter text to search for.';
            this.state.replaceInFilesSummary = null;
            this.renderReplaceStatus();
            return;
        }
        const matches = this.state.searchInFilesResults || [];
        if (!matches.length) {
            this.state.replaceInFilesError = 'No matches to replace.';
            this.state.replaceInFilesSummary = null;
            this.renderReplaceStatus();
            return;
        }
        const selectedIds = selectedOnly
            ? Array.from(this.state.selectedMatchIds instanceof Set ? this.state.selectedMatchIds : [])
            : [];
        if (selectedOnly && selectedIds.length === 0) {
            this.state.replaceInFilesError = 'Select at least one match to replace.';
            this.state.replaceInFilesSummary = null;
            this.renderReplaceStatus();
            return;
        }
        if (!selectedOnly && this.state.searchInFilesTruncated) {
            const proceed = confirm('Search results are truncated. Replace All may affect more matches than shown. Continue?');
            if (!proceed) return;
        }

        const estimated = selectedOnly ? selectedIds.length : matches.length;
        if (estimated >= 1000) {
            const proceed = confirm(`Replace ${estimated} occurrence${estimated === 1 ? '' : 's'}?`);
            if (!proceed) return;
        }

        this.state.replaceInFilesLoading = true;
        this.state.replaceInFilesError = null;
        this.state.replaceInFilesSummary = null;
        this.renderReplaceStatus();
        this.updateReplaceButtons();

        try {
            const excludePatterns = parsePatterns(this.state.searchInFilesExclude);
            const result = await callToolWithLoader('explorer', 'replace_text', {
                path: this.resolveSearchBasePath(),
                query,
                replaceWith: this.state.replaceInFilesWith ?? '',
                caseSensitive: this.state.searchInFilesCase,
                useRegex: this.state.searchInFilesRegex,
                wholeWord: this.state.searchInFilesWholeWord,
                excludePatterns,
                selectedMatchIds: selectedOnly ? selectedIds : [],
                dryRun: false
            });
            let payload = result?.json;
            if (!payload) {
                try {
                    payload = JSON.parse(result?.text || '{}');
                } catch (_) {
                    payload = null;
                }
            }
            if (!payload) {
                const text = typeof result?.text === 'string' ? result.text.trim() : '';
                if (text.startsWith('Error:')) {
                    throw new Error(text.replace(/^Error:\s*/i, '') || 'Replace failed.');
                }
                throw new Error('Invalid replace response.');
            }
            const summary = payload?.summary;
            const replacements = summary?.totalReplacements ?? 0;
            const filesChanged = summary?.filesChanged ?? 0;
            if (payload?.errors?.length) {
                console.warn('replace_text errors', payload.errors);
            }
            const missing = summary?.missingMatches || 0;
            if (replacements > 0) {
                if (filesChanged > 0) {
                    this.state.replaceInFilesSummary = `Replaced ${replacements} occurrence${replacements === 1 ? '' : 's'} in ${filesChanged} file${filesChanged === 1 ? '' : 's'}.`;
                } else {
                    this.state.replaceInFilesSummary = `Matched ${replacements} occurrence${replacements === 1 ? '' : 's'}, but no file content changed.`;
                }
            } else {
                this.state.replaceInFilesSummary = 'No replacements were made.';
            }
            if (missing > 0) {
                this.state.replaceInFilesSummary += ` ${missing} selected match${missing === 1 ? '' : 'es'} no longer available.`;
            }
            if (payload?.errors?.length) {
                this.state.replaceInFilesSummary += ` ${payload.errors.length} file${payload.errors.length === 1 ? '' : 's'} failed.`;
            }
            this.searchInFilesCache.clear();
            if (Array.isArray(payload?.changedFiles) && payload.changedFiles.length > 0) {
                window.dispatchEvent(new CustomEvent(FILE_EXP_REPLACE_COMPLETE_EVENT, {
                    detail: { changedFiles: payload.changedFiles }
                }));
            }
            await this.runSearchInFiles();
        } catch (error) {
            console.error('replace_text failed', error);
            this.state.replaceInFilesError = error?.message || 'Replace failed.';
        } finally {
            this.state.replaceInFilesLoading = false;
            this.renderReplaceStatus();
            this.updateReplaceButtons();
        }
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
