import {
    buildEditableFallbackCommitMessage,
    normalizeSlashes,
    parseJsonToolResult,
    stripTrailingSlash
} from "./git-commit-modal-utils.js";
import { withGlobalLoader } from "/explorer/utils/globalLoader.js";

export function createCommitMessageActions(ctx) {
    const {
        service,
        setStatusLine,
        setCommitMessage,
        updateCommitButtons,
        getSelectedReposForBatch,
        getPathsForCommitInRepo
    } = ctx;

    const isDiffFileHeaderLine = (line) => {
        if (!line) return false;
        return (
            line.startsWith('diff --git ') ||
            line.startsWith('index ') ||
            line.startsWith('new file mode ') ||
            line.startsWith('deleted file mode ') ||
            line.startsWith('old mode ') ||
            line.startsWith('new mode ') ||
            line.startsWith('similarity index ') ||
            line.startsWith('rename from ') ||
            line.startsWith('rename to ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('Binary files ') ||
            line.startsWith('GIT binary patch')
        );
    };

    const summarizeDiffForAi = (diffText, { maxLines = 120 } = {}) => {
        const lines = String(diffText || '').split(/\r?\n/);
        const out = [];
        let contentCount = 0;
        for (const line of lines) {
            if (line.startsWith('@@')) {
                out.push(line);
                continue;
            }
            if (isDiffFileHeaderLine(line)) continue;
            if (!line.startsWith('+') && !line.startsWith('-')) continue;
            if (contentCount >= maxLines) continue;
            out.push(line);
            contentCount += 1;
        }
        if (out.length === 0 && lines.length > 0) {
            return lines.slice(0, maxLines).join('\n');
        }
        return out.join('\n');
    };

    const encodeBase64 = (value) => {
        const raw = String(value ?? '');
        try {
            return btoa(unescape(encodeURIComponent(raw)));
        } catch {
            try {
                return btoa(raw);
            } catch {
                return '';
            }
        }
    };

    const getFallbackFileList = (selections) => {
        const out = [];
        const entries = Array.isArray(selections) ? selections : [];
        for (const selection of entries) {
            const repoPath = stripTrailingSlash(selection?.repoPath || '');
            const files = Array.isArray(selection?.files) ? selection.files : [];
            for (const file of files) {
                const normalizedFile = normalizeSlashes(String(file || '').trim());
                if (!normalizedFile) continue;
                const normalizedRepo = repoPath ? normalizeSlashes(repoPath) : '';
                const displayPath = normalizedRepo && normalizedFile.startsWith(`${normalizedRepo}/`)
                    ? normalizedFile.slice(normalizedRepo.length + 1)
                    : normalizedFile.replace(/^\/+/, '');
                if (displayPath) out.push(displayPath);
            }
        }
        return [...new Set(out)];
    };

    const promptForFallbackCommitMessage = async (selections) => {
        const fallbackMessage = buildEditableFallbackCommitMessage(selections);
        const files = getFallbackFileList(selections);
        const result = await assistOS.UI.showModal('git-commit-message-fallback-modal', {
            message: encodeBase64(fallbackMessage),
            files: encodeBase64(JSON.stringify(files))
        }, true);
        const message = String(result?.message || '').trim();
        return message || null;
    };

    const generateCommitMessageForSelections = async (selections) => {
        const cleanSelections = Array.isArray(selections) ? selections : [];
        const diffs = [];
        const maxFilesPerRepo = 80;
        const maxFilesTotal = 20;
        for (const selection of cleanSelections) {
            const repoPath = selection?.repoPath;
            const files = Array.isArray(selection?.files) ? selection.files.slice(0, maxFilesPerRepo) : [];
            if (!repoPath || !files.length) continue;
            for (const filePath of files) {
                if (diffs.length >= maxFilesTotal) break;
                const diff = await service.gitDiff({
                    path: repoPath,
                    file: filePath,
                    cached: true,
                    ref: 'HEAD'
                });
                const summary = summarizeDiffForAi(diff, { maxLines: 120 });
                diffs.push({ repoPath, filePath, diff: summary || '' });
            }
            if (diffs.length >= maxFilesTotal) break;
        }
        if (!diffs.length) return '';
        const payloadText = await service.generateCommitMessage(diffs);
        const payload = parseJsonToolResult(payloadText);
        if (!payload || typeof payload !== 'object') {
            throw new Error('Failed to generate commit message.');
        }
        if (payload.ok === false) {
            throw new Error(payload.error || 'Failed to generate commit message.');
        }
        return String(payload.message || '').trim();
    };

    const generateCommitMessage = async () => {
        const selectedRepos = getSelectedReposForBatch();
        if (!selectedRepos.length) {
            setStatusLine('Select at least one file to generate a message.', true);
            return;
        }

        setStatusLine('Generating commit message...');
        const selections = selectedRepos.map((repoPath) => ({
            repoPath,
            files: getPathsForCommitInRepo(repoPath)
        })).filter((entry) => entry.repoPath && Array.isArray(entry.files) && entry.files.length > 0);
        if (!selections.length) {
            setStatusLine('Select at least one file to generate a message.', true);
            return;
        }

        const result = await withGlobalLoader(async () => {
            try {
                const diffs = [];
                const maxFilesPerRepo = 80;
                const maxFilesTotal = 20;

                for (const selection of selections) {
                    const repoPath = selection.repoPath;
                    const files = Array.isArray(selection.files) ? selection.files.slice(0, maxFilesPerRepo) : [];
                    for (const filePath of files) {
                        if (diffs.length >= maxFilesTotal) break;
                        const diff = await service.gitDiff({
                            path: repoPath,
                            file: filePath,
                            cached: false,
                            ref: 'HEAD'
                        });
                        const summary = summarizeDiffForAi(diff, { maxLines: 120 });
                        diffs.push({ repoPath, filePath, diff: summary || '' });
                    }
                    if (diffs.length >= maxFilesTotal) break;
                }

                if (!diffs.length) {
                    return { ok: false, emptySelection: true };
                }

                const payloadText = await service.generateCommitMessage(diffs);
                const payload = parseJsonToolResult(payloadText);
                if (!payload || typeof payload !== 'object') {
                    throw new Error('Failed to generate commit message.');
                }
                if (payload.ok === false) {
                    throw new Error(payload.error || 'Failed to generate commit message.');
                }
                const next = String(payload.message || '').trim();
                if (!next) throw new Error('AI returned an empty commit message.');

                return { ok: true, message: next };
            } catch (error) {
                return { ok: false, error };
            }
        });

        if (result?.ok) {
            setCommitMessage(result.message);
            updateCommitButtons();
            setStatusLine('Commit message generated.');
            return;
        }

        if (result?.emptySelection) {
            setStatusLine('Select at least one file to generate a message.', true);
            return;
        }

        const message = await promptForFallbackCommitMessage(selections);
        if (!message) {
            setStatusLine('Commit message generation canceled.', true);
            return;
        }
        setCommitMessage(message);
        updateCommitButtons();
        setStatusLine('Using edited fallback commit message.');
    };

    return {
        generateCommitMessageForSelections,
        promptForFallbackCommitMessage,
        generateCommitMessage
    };
}
