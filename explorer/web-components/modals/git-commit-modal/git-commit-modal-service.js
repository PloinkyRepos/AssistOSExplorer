export function createGitCommitService({ callTool, callAgentTool }) {
    return {
        gitDiff: (args) => callTool('git_diff', args),
        gitInfo: (path) => callTool('git_info', { path }),
        gitReposOverview: (path) => callTool('git_repos_overview', { path }),
        listDirectoryDetailed: (path) => callTool('list_directory_detailed', { path }),
        gitStatus: (path) => callTool('git_status', { path }),
        gitPush: (payload) => callTool('git_push', payload),
        gitPull: (payload) => callTool('git_pull', payload),
        gitIdentity: (path) => callTool('git_identity', { path }),
        gitSetIdentity: (payload) => callTool('git_set_identity', payload),
        gitStage: (path, files) => callTool('git_stage', { path, files }),
        gitUntrack: (path, files) => callTool('git_untrack', { path, files }),
        gitRestore: (path, files) => callTool('git_restore', { path, files }),
        gitCommit: (payload) => callTool('git_commit', payload),
        deleteFile: (path) => callTool('delete_file', { path }),
        readTextFile: (path) => callTool('read_text_file', { path }),
        writeFile: (path, content) => callTool('write_file', { path, content }),
        generateCommitMessage: (diffs) => callAgentTool('explorerSkillsAgent', 'git_commit_message', { diffs })
    };
}
