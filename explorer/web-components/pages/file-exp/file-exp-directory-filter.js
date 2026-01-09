import { parsePatterns } from "./file-exp-utils.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";

const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 500;
const DEFAULT_EXCLUDE = 'node_modules,.git';

export function createDirectoryFilterController(fileExp) {
    let timer = null;
    let requestId = 0;

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const cancelInFlight = () => {
        requestId += 1;
        clearTimer();
    };

    const applyLocalFilter = async () => {
        await fileExp.setEntries(fileExp.state.allEntries);
        fileExp.renderEntriesBody();
    };

    const schedule = (rawQuery, { filterInput, filterClear } = {}) => {
        const query = String(rawQuery || '');
        const trimmed = query.trim();
        fileExp.state.directoryFilterQuery = query;

        if (filterClear) {
            filterClear.disabled = !trimmed;
        }

        cancelInFlight();

        if (!trimmed) {
            void applyLocalFilter();
            return;
        }

        if (trimmed.length < MIN_QUERY_LENGTH) {
            void applyLocalFilter();
            return;
        }

        const currentRequestId = requestId;
        timer = setTimeout(() => {
            void run(query, { requestId: currentRequestId, filterInput });
        }, DEBOUNCE_MS);
    };

    const run = async (rawQuery, { requestId: localRequestId, filterInput } = {}) => {
        const query = String(rawQuery || '').trim();
        if (query.length < MIN_QUERY_LENGTH) {
            return;
        }

        const basePath = '/';
        const excludePatterns = parsePatterns(fileExp.state.searchByNameExclude || DEFAULT_EXCLUDE);

        try {
            const result = await callToolWithLoader('explorer', 'search_files', {
                path: basePath,
                pattern: query,
                excludePatterns,
                maxResults: MAX_RESULTS
            });

            if (localRequestId !== requestId) {
                return;
            }

            const lines = (result.text || '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.toLowerCase().includes('no matches'));

            const entries = lines
                .map((line) => fileExp.normalizePath(line.startsWith('/') ? line : `/${line}`))
                .map((fullPath) => {
                    const relative = fullPath.replace(/^\//, '');
                    const name = relative || fullPath.split('/').pop() || '/';
                    return {
                        name,
                        path: fullPath,
                        type: 'other',
                        size: null,
                        modified: null
                    };
                })
                .filter((entry) => entry.name);

            const filteredBySpecs = fileExp.state.filterSpecs
                ? entries.filter((entry) => fileExp.isMarkdownFile(entry.name) || fileExp.isMarkdownFile(entry.path))
                : entries;

            fileExp.state.entries = fileExp.sortEntries(filteredBySpecs);
            fileExp.renderEntriesBody();
        } catch (error) {
            if (localRequestId !== requestId) {
                return;
            }
            console.error('search_files failed', error);
            fileExp.showStatus(error?.message || 'Search failed.', true);
            fileExp.state.entries = [];
            fileExp.renderEntriesBody();
        } finally {
            if (localRequestId !== requestId) {
                return;
            }
            if (filterInput && document.activeElement !== filterInput) {
                filterInput.focus({ preventScroll: true });
            }
        }
    };

    const bindControls = () => {
        const filterInput = fileExp.element.querySelector('#directoryFilterInput');
        const filterClear = fileExp.element.querySelector('#directoryFilterClear');

        if (filterInput && !filterInput.dataset.bound) {
            filterInput.addEventListener('input', (event) => {
                const selectionStart = filterInput.selectionStart;
                const selectionEnd = filterInput.selectionEnd;
                schedule(event.target.value, { filterInput, filterClear });
                if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
                    try {
                        filterInput.setSelectionRange(selectionStart, selectionEnd);
                    } catch (_) {
                        // ignore
                    }
                }
            });
            filterInput.addEventListener('keydown', async (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelInFlight();
                    fileExp.state.directoryFilterQuery = '';
                    filterInput.value = '';
                    await applyLocalFilter();
                    filterInput.focus({ preventScroll: true });
                }
            });
            filterInput.dataset.bound = 'true';
        }

        if (filterInput) {
            const value = String(fileExp.state.directoryFilterQuery || '');
            if (filterInput.value !== value) {
                filterInput.value = value;
            }
        }

        if (filterClear && !filterClear.dataset.bound) {
            filterClear.addEventListener('click', async () => {
                cancelInFlight();
                fileExp.state.directoryFilterQuery = '';
                if (filterInput) {
                    filterInput.value = '';
                    filterInput.focus({ preventScroll: true });
                }
                await applyLocalFilter();
            });
            filterClear.dataset.bound = 'true';
        }

        if (filterClear) {
            filterClear.disabled = !String(fileExp.state.directoryFilterQuery || '').trim();
        }
    };

    const rerunIfActive = async () => {
        const trimmed = String(fileExp.state.directoryFilterQuery || '').trim();
        if (trimmed.length < MIN_QUERY_LENGTH) {
            return;
        }
        cancelInFlight();
        const currentRequestId = requestId;
        await run(trimmed, { requestId: currentRequestId });
    };

    return {
        bindControls,
        schedule,
        run,
        rerunIfActive,
        cancelInFlight
    };
}
