export function createGitCommitService({ callTool, callAgentTool }) {
    return {
        gitDiff: (args) => callAgentTool('gitAgent', 'git_diff', args),
        gitInfo: (path) => callAgentTool('gitAgent', 'git_info', { path }),
        gitReposOverview: (path) => callAgentTool('gitAgent', 'git_repos_overview', { path }),
        listDirectoryDetailed: (path) => callTool('list_directory_detailed', { path }),
        gitStatus: (path) => callAgentTool('gitAgent', 'git_status', { path }),
        gitPush: (payload) => callAgentTool('gitAgent', 'git_push', payload),
        gitPull: (payload) => callAgentTool('gitAgent', 'git_pull', payload),
        gitStage: (path, files) => callAgentTool('gitAgent', 'git_stage', { path, files }),
        gitUntrack: (path, files) => callAgentTool('gitAgent', 'git_untrack', { path, files }),
        gitCheckIgnore: (path, files) => callAgentTool('gitAgent', 'git_check_ignore', { path, files }),
        gitRestore: (path, files) => callAgentTool('gitAgent', 'git_restore', { path, files }),
        gitConflictVersions: (payload) => callAgentTool('gitAgent', 'git_conflict_versions', payload),
        gitCheckoutConflict: (payload) => callAgentTool('gitAgent', 'git_checkout_conflict', payload),
        gitStash: (payload) => callAgentTool('gitAgent', 'git_stash', payload),
        gitStashPop: (payload) => callAgentTool('gitAgent', 'git_stash_pop', payload),
        gitCommit: (payload) => callAgentTool('gitAgent', 'git_commit', payload),
        deleteFile: (path) => callTool('delete_file', { path }),
        readTextFile: (path) => callTool('read_text_file', { path }),
        writeFile: (path, content) => callTool('write_file', { path, content }),
        generateCommitMessage: (diffs) => callAgentTool('gitAgent', 'git_commit_message', { diffs })
    };
}
