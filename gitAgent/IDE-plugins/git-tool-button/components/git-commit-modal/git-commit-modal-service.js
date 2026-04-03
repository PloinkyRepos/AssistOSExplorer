import { parseJsonToolResult } from "./git-commit-modal-utils.js";

export function createGitCommitService({ callTool, callAgentTool }) {
    const compact = (payload) => {
        const next = {};
        for (const [key, value] of Object.entries(payload || {})) {
            if (value === null || value === undefined) continue;
            next[key] = value;
        }
        return next;
    };
    const callGitAuthJson = async (toolName, args = {}) => {
        const payload = parseJsonToolResult(await callAgentTool('gitAgent', toolName, args, { raw: true })) || {};
        if (payload?.ok === false) {
            throw new Error(String(payload?.message || payload?.error || 'git_auth_request_failed'));
        }
        return {
            ok: true,
            github: payload,
            token: payload?.token || ''
        };
    };
    return {
        gitDiff: (args) => callAgentTool('gitAgent', 'git_diff', args),
        gitInfo: (path) => callAgentTool('gitAgent', 'git_info', { path }),
        gitReposOverview: (path) => callAgentTool('gitAgent', 'git_repos_overview', { path }),
        listDirectoryDetailed: (path) => callTool('list_directory_detailed', { path }),
        gitStatus: (path, options = {}) => callAgentTool('gitAgent', 'git_status', { path, ...options }),
        gitPush: (payload) => callAgentTool('gitAgent', 'git_push', payload),
        gitPull: (payload) => callAgentTool('gitAgent', 'git_pull', payload),
        gitSetIdentity: (payload) => callAgentTool('gitAgent', 'git_set_identity', payload),
        gitStage: (path, files) => callAgentTool('gitAgent', 'git_stage', { path, files }),
        gitStageExact: (path, files) => callAgentTool('gitAgent', 'git_stage_exact', { path, files }),
        gitUntrack: (path, files) => callAgentTool('gitAgent', 'git_untrack', { path, files }),
        gitCheckIgnore: (path, files) => callAgentTool('gitAgent', 'git_check_ignore', { path, files }),
        gitRestore: (path, files) => callAgentTool('gitAgent', 'git_restore', { path, files }),
        gitConflictVersions: (payload) => callAgentTool('gitAgent', 'git_conflict_versions', payload),
        gitCheckoutConflict: (payload) => callAgentTool('gitAgent', 'git_checkout_conflict', payload),
        gitStash: (payload) => callAgentTool('gitAgent', 'git_stash', payload),
        gitStashList: (payload) => callAgentTool('gitAgent', 'git_stash_list', payload),
        gitStashPop: (payload) => callAgentTool('gitAgent', 'git_stash_pop', compact(payload), { raw: true }),
        gitCommit: (payload) => callAgentTool('gitAgent', 'git_commit', payload),
        llmResolveConflict: (payload) => callAgentTool('llmAssistant', 'llm_resolve_conflict', payload),
        deleteFile: (path) => callTool('delete_file', { path }),
        readTextFile: (path) => callTool('read_text_file', { path }),
        writeFile: (path, content) => callTool('write_file', { path, content }),
        generateCommitMessage: (diffs) => callAgentTool('llmAssistant', 'git_commit_message', { diffs }),
        githubAuthStatus: () => callGitAuthJson('git_auth_status'),
        startGithubDeviceFlow: () => callGitAuthJson('git_auth_begin'),
        pollGithubDeviceFlow: () => callGitAuthJson('git_auth_poll'),
        disconnectGithubAuth: () => callGitAuthJson('git_auth_disconnect'),
        storeManualGitToken: (token) => callGitAuthJson('git_auth_store_token', { token })
    };
}
