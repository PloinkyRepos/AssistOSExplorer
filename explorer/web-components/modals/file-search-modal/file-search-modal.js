import { normalizePath, parsePatterns, groupMatchesByFile } from "../../pages/file-exp/file-exp-utils.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";

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
            searchByNameQuery: props.searchByNameQuery || '',
            searchByNameExclude: props.searchByNameExclude || this.defaultExclude,
            searchByNameResults: [],
            searchByNameLoading: false,
            searchByNameError: null,
            searchInFilesQuery: props.searchInFilesQuery || '',
            searchInFilesExclude: props.searchInFilesExclude || this.defaultExclude,
            searchInFilesCase: Boolean(props.searchInFilesCase),
            searchInFilesResults: [],
            searchInFilesFileResults: [],
            searchInFilesLoading: false,
            searchInFilesError: null,
            searchInFilesTruncated: false,
            searchByNameTimer: null,
            searchInFilesTimer: null
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.syncUIFromState();
        this.bindEvents();
        this.runInitialSearch();
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

        const closeButton = this.element.querySelector('#searchModalClose');
        if (closeButton && !closeButton.dataset.bound) {
            closeButton.addEventListener('click', () => this.closeModal());
            closeButton.dataset.bound = 'true';
        }

        const byNameResults = this.element.querySelector('#searchByNameResults');
        if (byNameResults && !byNameResults.dataset.boundClick) {
            byNameResults.addEventListener('click', (event) => {
                const target = event.target.closest('.search-result-item');
                if (target?.dataset?.filePath) {
                    const line = target.dataset.line ? Number.parseInt(target.dataset.line, 10) : null;
                    this.closeModal({ path: target.dataset.filePath, line });
                }
            });
            byNameResults.dataset.boundClick = 'true';
        }

        const inFilesResults = this.element.querySelector('#searchInFilesResults');
        if (inFilesResults && !inFilesResults.dataset.boundClick) {
            inFilesResults.addEventListener('click', (event) => {
                const target = event.target.closest('.search-result-item');
                if (target?.dataset?.filePath) {
                    const line = target.dataset.line ? Number.parseInt(target.dataset.line, 10) : null;
                    this.closeModal({ path: target.dataset.filePath, line });
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
        this.state.mode = mode;
        const nameOverlay = this.element.querySelector('#searchByNameOverlay');
        const textOverlay = this.element.querySelector('#searchInFilesOverlay');
        if (nameOverlay) {
            nameOverlay.classList.toggle('open', mode === 'name');
            nameOverlay.setAttribute('aria-hidden', mode === 'name' ? 'false' : 'true');
        }
        if (textOverlay) {
            textOverlay.classList.toggle('open', mode === 'in-files');
            textOverlay.setAttribute('aria-hidden', mode === 'in-files' ? 'false' : 'true');
        }
    }

    syncUIFromState() {
        const state = this.state;
        this.setMode(state.mode);
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
        const textCaseInput = this.element.querySelector('#searchInFilesCase');
        if (textCaseInput) {
            textCaseInput.checked = Boolean(state.searchInFilesCase);
        }
        this.renderSearchByNameResults();
        this.renderSearchInFilesResults();
    }

    runInitialSearch() {
        if (this.state.mode === 'name' && this.state.searchByNameQuery.trim().length >= 2) {
            this.runSearchByName();
        }
        if (this.state.mode === 'in-files' && this.state.searchInFilesQuery.trim()) {
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
        const query = (this.state.searchInFilesQuery || '').trim();
        if (!query) {
            this.searchInFilesRequestId += 1;
            this.state.searchInFilesLoading = false;
            this.state.searchInFilesError = 'Enter text to search for.';
            this.state.searchInFilesResults = [];
            this.state.searchInFilesFileResults = [];
            this.state.searchInFilesTruncated = false;
            this.renderSearchInFilesResults();
            return;
        }
        this.state.searchInFilesTimer = setTimeout(() => this.runSearchInFiles(), 200);
    }

    buildSearchInFilesCacheKey() {
        const basePath = this.state.basePath || '/';
        const query = (this.state.searchInFilesQuery || '').trim();
        const exclude = this.state.searchInFilesExclude || this.defaultExclude;
        const caseSensitive = Boolean(this.state.searchInFilesCase);
        return JSON.stringify({ basePath, query, exclude, caseSensitive });
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
            const result = await callToolWithLoader('explorer', 'search_files', {
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
                this.state.searchInFilesFileResults = groupMatchesByFile(this.state.searchInFilesResults);
                this.state.searchInFilesTruncated = Boolean(cached.truncated);
                return;
            }

            const excludePatterns = parsePatterns(this.state.searchInFilesExclude);
            const result = await callToolWithLoader('explorer', 'search_text', {
                path: this.state.basePath || '/',
                query,
                caseSensitive: this.state.searchInFilesCase,
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
            this.state.searchInFilesResults = matches.map((match) => ({
                path: match.path ? normalizePath(match.path) : '/',
                line: match.line || null,
                preview: match.preview || ''
            }));
            this.state.searchInFilesFileResults = groupMatchesByFile(this.state.searchInFilesResults);
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
        } finally {
            if (requestId !== this.searchInFilesRequestId) {
                return;
            }
            this.state.searchInFilesLoading = false;
            this.renderSearchInFilesResults();
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

        const files = this.state.searchInFilesFileResults;
        if (this.state.searchInFilesLoading) {
            status.textContent = 'Searching across files...';
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
        status.textContent = `${files.length} file${files.length === 1 ? '' : 's'}${truncatedNote}`;
        if (this.state.searchInFilesTruncated) {
            status.classList.add('strong');
        }

        files.forEach((item) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'search-result-item';
            row.dataset.filePath = item.path;
            if (item.firstLine) {
                row.dataset.line = item.firstLine;
            }
            const pathLabel = document.createElement('div');
            pathLabel.className = 'search-result-path';
            pathLabel.textContent = item.firstLine ? `${item.path}:${item.firstLine}` : item.path;
            const meta = document.createElement('div');
            meta.className = 'search-result-meta';
            meta.textContent = `${item.count} match${item.count === 1 ? '' : 'es'}`;
            const preview = document.createElement('div');
            preview.className = 'search-result-preview';
            preview.textContent = item.preview || '';
            row.appendChild(pathLabel);
            row.appendChild(meta);
            row.appendChild(preview);
            container.appendChild(row);
        });
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
