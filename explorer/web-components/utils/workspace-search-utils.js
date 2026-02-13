import { normalizePath } from "../pages/file-exp/file-exp-utils.js";

function parsePositiveInteger(value, { allowZero = false } = {}) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return null;
    if (allowZero) {
        return parsed >= 0 ? parsed : null;
    }
    return parsed > 0 ? parsed : null;
}

export function parsePositiveLineValue(value) {
    return parsePositiveInteger(value, { allowZero: false });
}

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function escapeRegExp(value) {
    return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSearchHighlightRegex({
    query = "",
    useRegex = false,
    wholeWord = false,
    caseSensitive = false
} = {}) {
    const trimmedQuery = String(query || "").trim();
    if (!trimmedQuery) return null;

    let pattern = useRegex ? trimmedQuery : escapeRegExp(trimmedQuery);
    if (wholeWord) {
        pattern = `\\b(?:${pattern})\\b`;
    }

    const flags = caseSensitive ? "g" : "gi";
    try {
        return new RegExp(pattern, flags);
    } catch (_) {
        return null;
    }
}

export function highlightSearchPreview(
    text,
    {
        query = "",
        useRegex = false,
        wholeWord = false,
        caseSensitive = false,
        contextBefore = 60,
        contextAfter = 50
    } = {}
) {
    const value = String(text ?? "");
    if (!value) return "";

    const regex = buildSearchHighlightRegex({ query, useRegex, wholeWord, caseSensitive });
    if (!regex) return escapeHtml(value);

    regex.lastIndex = 0;
    const firstMatch = regex.exec(value);
    if (!firstMatch) {
        return escapeHtml(value);
    }

    const matchText = firstMatch[0] ?? "";
    const matchIndex = Number.isFinite(firstMatch.index) ? firstMatch.index : 0;
    const start = Math.max(0, matchIndex - Math.max(0, contextBefore));
    const end = Math.min(value.length, matchIndex + matchText.length + Math.max(0, contextAfter));
    const snippet = value.slice(start, end);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < value.length ? "…" : "";

    regex.lastIndex = 0;
    let lastIndex = 0;
    let result = "";
    let match;
    while ((match = regex.exec(snippet)) !== null) {
        const textMatch = match[0] ?? "";
        const localStart = Number.isFinite(match.index) ? match.index : 0;
        const localEnd = localStart + textMatch.length;
        result += escapeHtml(snippet.slice(lastIndex, localStart));
        result += `<mark class="search-highlight">${escapeHtml(snippet.slice(localStart, localEnd))}</mark>`;
        lastIndex = localEnd;
        if (textMatch.length === 0) {
            regex.lastIndex = localStart + 1;
        }
    }

    result += escapeHtml(snippet.slice(lastIndex));
    return `${prefix}${result}${suffix}`;
}

export function parseToolJsonPayload(result) {
    let payload = result?.json;
    if (payload) {
        return payload;
    }
    try {
        payload = JSON.parse(result?.text || "{}");
    } catch (_) {
        payload = null;
    }
    return payload;
}

export async function withTimeout(taskOrPromise, { timeoutMs = 0, timeoutMessage = "Request timed out." } = {}) {
    const timeoutValue = Number.parseInt(String(timeoutMs ?? 0), 10);
    if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        return typeof taskOrPromise === "function" ? taskOrPromise() : taskOrPromise;
    }
    const taskPromise = Promise.resolve().then(() => (
        typeof taskOrPromise === "function" ? taskOrPromise() : taskOrPromise
    ));
    let timerId = null;
    const timeoutPromise = new Promise((_resolve, reject) => {
        timerId = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutValue);
    });
    try {
        return await Promise.race([taskPromise, timeoutPromise]);
    } finally {
        if (timerId) {
            clearTimeout(timerId);
        }
    }
}

export function normalizeSearchTextMatches(matches = []) {
    return (Array.isArray(matches) ? matches : []).map((match) => {
        const path = match?.path ? normalizePath(match.path) : "/";
        const line = parsePositiveInteger(match?.line);
        const column = parsePositiveInteger(match?.column);
        const parsedMatchIndex = parsePositiveInteger(match?.matchIndex, { allowZero: true });
        const matchIndex = parsedMatchIndex ?? 0;
        const id = match?.id || `${path}:${line || 0}:${column || 0}:${matchIndex}`;

        return {
            path,
            line,
            column,
            matchIndex,
            match: match?.match || "",
            preview: match?.preview || "",
            id
        };
    });
}

export function groupSearchMatchesByFileDetailed(matches = []) {
    const grouped = new Map();
    matches.forEach((item) => {
        if (!item?.path) return;
        const existing = grouped.get(item.path) || {
            path: item.path,
            count: 0,
            firstLine: null,
            preview: "",
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

export function filterMatchesByPaths(matches = [], excludedPaths = []) {
    const excludedSet = new Set(
        (Array.isArray(excludedPaths) ? excludedPaths : [])
            .map((value) => normalizePath(value))
            .filter(Boolean)
    );
    if (!excludedSet.size) {
        return Array.isArray(matches) ? matches : [];
    }
    return (Array.isArray(matches) ? matches : []).filter((item) => !excludedSet.has(normalizePath(item?.path)));
}

export function mergeSearchMatchesByPaths({
    currentMatches = [],
    refreshedMatches = [],
    refreshedPaths = []
} = {}) {
    const normalizedPaths = Array.from(new Set(
        (Array.isArray(refreshedPaths) ? refreshedPaths : [])
            .map((value) => normalizePath(value))
            .filter(Boolean)
    ));
    const withoutRefreshedPaths = filterMatchesByPaths(currentMatches, normalizedPaths);
    const nextMatches = [
        ...(Array.isArray(withoutRefreshedPaths) ? withoutRefreshedPaths : []),
        ...(Array.isArray(refreshedMatches) ? refreshedMatches : [])
    ];
    nextMatches.sort((a, b) => {
        const pathA = String(a?.path || "");
        const pathB = String(b?.path || "");
        if (pathA < pathB) return -1;
        if (pathA > pathB) return 1;
        const lineDiff = (a?.line || 0) - (b?.line || 0);
        if (lineDiff !== 0) return lineDiff;
        const colDiff = (a?.column || 0) - (b?.column || 0);
        if (colDiff !== 0) return colDiff;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
    });
    return nextMatches;
}

export function computeOptimisticSearchMatchesAfterReplace({
    matches = [],
    selectedOnly = false,
    selectedIds = [],
    changedFiles = [],
    replacements = 0
} = {}) {
    if (!Number.isFinite(replacements) || replacements <= 0) {
        return Array.isArray(matches) ? matches : [];
    }

    const currentMatches = Array.isArray(matches) ? matches : [];
    if (!currentMatches.length) {
        return [];
    }

    let nextMatches = currentMatches;
    if (selectedOnly) {
        const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);
        if (selectedSet.size > 0) {
            nextMatches = currentMatches.filter((item) => !selectedSet.has(item.id));
        }
    } else {
        nextMatches = [];
    }

    if (Array.isArray(changedFiles) && changedFiles.length > 0) {
        nextMatches = filterMatchesByPaths(nextMatches, changedFiles);
    }

    return nextMatches;
}
