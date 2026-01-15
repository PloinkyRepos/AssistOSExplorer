import {
    parseJsonToolResult,
    getRememberedGitPat,
    getAutocommitSettings,
    getGitConflictFlag,
    setGitConflictFlag
} from "../../modals/git-commit-modal/git-commit-modal-utils.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";

export function attachGitController(fileExp) {
    const reposRoot = '/.ploinky/repos';
    const AUTOCOMMIT_MESSAGE = 'chore: autocommit';

    const getConflictFlag = () => getGitConflictFlag();
    const setConflictFlag = (value) => setGitConflictFlag(Boolean(value));

    const updateGitButtonIndicator = () => {
        const button = fileExp.element?.querySelector?.('#gitButton');
        if (!button) return;
        button.classList.toggle('has-conflicts', getConflictFlag());
    };

    const autocommit = {
        timerId: null,
        running: false,
        scheduledIntervalMinutes: null
    };

    const clearAutocommitTimer = () => {
        if (autocommit.timerId) {
            clearInterval(autocommit.timerId);
            autocommit.timerId = null;
        }
        autocommit.running = false;
        autocommit.scheduledIntervalMinutes = null;
    };

    const ensureAutocommitTimer = () => {
        const { enabled, intervalMinutes } = getAutocommitSettings();
        if (!enabled) {
            clearAutocommitTimer();
            return;
        }
        if (getConflictFlag()) {
            clearAutocommitTimer();
            return;
        }
        if (autocommit.timerId && autocommit.scheduledIntervalMinutes === intervalMinutes) {
            return;
        }
        clearAutocommitTimer();
        autocommit.scheduledIntervalMinutes = intervalMinutes;
        autocommit.timerId = setInterval(() => {
            runAutocommitTick();
        }, Math.max(1, intervalMinutes) * 60 * 1000);
    };

    const callGitTool = async (toolName, args) => {
        const result = await callToolWithLoader('explorer', toolName, args);
        const parsed = parseJsonToolResult(result);
        if (parsed !== null && parsed !== undefined) {
            return parsed;
        }
        const text = typeof result?.text === 'string' ? result.text.trim() : '';
        if (text) {
            return parseJsonToolResult(text);
        }
        return null;
    };

    const callAgentTool = async (agentName, name, args) => {
        const client = window.webSkel?.appServices?.getClient?.(agentName);
        if (!client || typeof client.callTool !== 'function') {
            throw new Error(`Agent client not available: ${agentName}`);
        }
        const result = await client.callTool(name, args || {});
        const blocks = Array.isArray(result?.content) ? result.content : [];
        const firstText = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
        let text = firstText ? firstText.text : JSON.stringify(result, null, 2);

        if (typeof text === 'string') {
            const trimmed = text.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed?.content)) {
                        const inner = parsed.content.find((block) => block?.type === 'text' && typeof block.text === 'string');
                        if (inner?.text) text = inner.text;
                    } else if (typeof parsed?.text === 'string') {
                        text = parsed.text;
                    }
                } catch {
                    // keep original text
                }
            }
        }

        if (text?.startsWith?.('Error:')) throw new Error(text);
        return text || '';
    };

    const listRepos = async () => {
        const payload = await callGitTool('git_repos_overview', { path: reposRoot }) || {};
        const repos = Array.isArray(payload?.repos) ? payload.repos : [];
        return repos.map((r) => r?.path).filter(Boolean);
    };

    const getRepoStatus = async (repoPath) => {
        const payload = await callGitTool('git_status', { path: repoPath }) || {};
        return payload?.status || payload || {};
    };

    const repoHasConflicts = (status) => {
        const conflicted = Array.isArray(status?.conflicted) ? status.conflicted : [];
        return conflicted.length > 0;
    };

    const runAutocommitTick = async () => {
        if (autocommit.running) return;
        const { enabled } = getAutocommitSettings();
        if (!enabled) return;
        if (getConflictFlag()) return;
        autocommit.running = true;
        try {
            const token = getRememberedGitPat();
            const raw = await callAgentTool('explorerSkillsAgent', 'git_autocommit_tick', {
                reposRoot,
                token,
                message: AUTOCOMMIT_MESSAGE
            });
            const parsed = parseJsonToolResult(raw);
            let result = parsed && typeof parsed === 'object' ? parsed : null;
            if (result?.message && typeof result.message === 'string') {
                const nested = parseJsonToolResult(result.message);
                if (nested && typeof nested === 'object') {
                    result = nested;
                }
            }
            if (!result) return;

            if (result.conflicts) {
                setConflictFlag(true);
                updateGitButtonIndicator();
                clearAutocommitTimer();
                const message = String(result.message || 'Merge conflicts detected.').trim();
                fileExp.showStatus(`Autocommit stopped: ${message}`, true);
                return;
            }

            if (result.ok === false || result.stopped) {
                clearAutocommitTimer();
                const message = String(result.message || 'Autocommit stopped.').trim();
                if (message) {
                    fileExp.showStatus(`Autocommit stopped: ${message}`, true);
                }
            }
        } catch {
            // ignore autocommit failures to avoid spamming; next tick will retry
        } finally {
            autocommit.running = false;
        }
    };

    const syncConflictFlagFromRepos = async () => {
        try {
            const repos = await listRepos();
            for (const repoPath of repos) {
                const status = await getRepoStatus(repoPath);
                if (repoHasConflicts(status)) {
                    setConflictFlag(true);
                    updateGitButtonIndicator();
                    return true;
                }
            }
            setConflictFlag(false);
            updateGitButtonIndicator();
            return false;
        } catch {
            updateGitButtonIndicator();
            return getConflictFlag();
        }
    };

    async function openGitModal() {
        await syncConflictFlagFromRepos();
        ensureAutocommitTimer();
        const repoPath = reposRoot;
        return fileExp.withLoader(async () => {
            const modal = await assistOS.UI.createReactiveModal('git-commit-modal', { repoPath });
            if (getConflictFlag()) {
                try {
                    const el = modal?.element || modal;
                    const presenter = el?.webSkelPresenter || el?.presenter || el;
                    presenter?.openConflictHelper?.();
                } catch {
                    // ignore
                }
            }
        });
    }

    updateGitButtonIndicator();
    ensureAutocommitTimer();
    window.addEventListener('storage', (event) => {
        if (!event?.key) return;
        if (event.key.startsWith('webskel.git.autocommit.')) {
            ensureAutocommitTimer();
            return;
        }
        if (event.key === 'webskel.git.conflicts') {
            updateGitButtonIndicator();
            ensureAutocommitTimer();
        }
    });

    Object.assign(fileExp, {
        openGitModal,
        updateGitButtonIndicator,
        ensureAutocommitTimer
    });
}
