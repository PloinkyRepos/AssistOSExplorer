export function createGitCommitService({ callTool, callAgentTool }) {
    const compact = (payload) => {
        const next = {};
        for (const [key, value] of Object.entries(payload || {})) {
            if (value === null || value === undefined) continue;
            next[key] = value;
        }
        return next;
    };
    const AUTH_AGENT = 'explorer';
    const callAuthJson = async (pathname, { method = 'GET', body = null } = {}) => {
        const hasQuery = pathname.includes('?');
        const url = `${pathname}${hasQuery ? '&' : '?'}agent=${encodeURIComponent(AUTH_AGENT)}`;
        const headers = { Accept: 'application/json' };
        const init = {
            method,
            headers,
            credentials: 'same-origin'
        };
        if (body !== null) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const response = await fetch(url, init);
        let payload = {};
        try {
            payload = await response.json();
        } catch {
            payload = {};
        }
        if (!response.ok || payload?.ok === false) {
            const message = payload?.message || payload?.error || `auth_http_${response.status}`;
            throw new Error(String(message || 'auth_request_failed'));
        }
        return payload;
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
        githubAuthStatus: () => callAuthJson('/auth/github/status'),
        startGithubDeviceFlow: () => callAuthJson('/auth/github/device/start', { method: 'POST', body: {} }),
        pollGithubDeviceFlow: () => callAuthJson('/auth/github/device/poll', { method: 'POST', body: {} }),
        disconnectGithubAuth: () => callAuthJson('/auth/github/disconnect', { method: 'POST', body: {} })
    };
}
