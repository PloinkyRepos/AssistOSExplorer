export function buildToolDefinitions(zodToJsonSchema, schemas) {
  const {
    ReadTextFileArgsSchema,
    ReadMediaFileArgsSchema,
    ReadMultipleFilesArgsSchema,
    WriteFileArgsSchema,
    WriteBinaryFileArgsSchema,
    EditFileArgsSchema,
    CreateDirectoryArgsSchema,
    DeleteFileArgsSchema,
    DeleteDirectoryArgsSchema,
    ListDirectoryArgsSchema,
    ListDirectoryWithSizesArgsSchema,
    ListDirectoryDetailedArgsSchema,
    DirectoryTreeArgsSchema,
    MoveFileArgsSchema,
    CopyFileArgsSchema,
    SearchFilesArgsSchema,
    SearchTextArgsSchema,
    GetFileInfoArgsSchema,
    CollectIDEPluginsArgsSchema,
    GitInfoArgsSchema,
    GitStatusArgsSchema,
    GitDiffArgsSchema,
    GitStageArgsSchema,
    GitUnstageArgsSchema,
    GitUntrackArgsSchema,
    GitCheckIgnoreArgsSchema,
    GitRestoreArgsSchema,
    GitCommitArgsSchema,
    GitPushArgsSchema,
    GitPullArgsSchema,
    GitDiagnoseArgsSchema,
    GitReposOverviewArgsSchema,
    GitIdentityArgsSchema,
    GitSetIdentityArgsSchema
  } = schemas;

  return [
    {
      name: 'read_file',
      description: 'Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.',
      inputSchema: zodToJsonSchema(ReadTextFileArgsSchema)
    },
    {
      name: 'read_text_file',
      description: 'Read the complete contents of a file from the file system as text. Handles encodings and optional head/tail.',
      inputSchema: zodToJsonSchema(ReadTextFileArgsSchema)
    },
    {
      name: 'read_media_file',
      description: 'Read an image or audio file and return base64 data with MIME type.',
      inputSchema: zodToJsonSchema(ReadMediaFileArgsSchema)
    },
    {
      name: 'read_multiple_files',
      description: 'Read the contents of multiple files simultaneously.',
      inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema)
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with new content.',
      inputSchema: zodToJsonSchema(WriteFileArgsSchema)
    },
    {
      name: 'write_binary_file',
      description: 'Create or overwrite a binary file using base64 encoded content.',
      inputSchema: zodToJsonSchema(WriteBinaryFileArgsSchema)
    },
    {
      name: 'edit_file',
      description: 'Apply textual edits to a file and return a diff.',
      inputSchema: zodToJsonSchema(EditFileArgsSchema)
    },
    {
      name: 'create_directory',
      description: 'Ensure a directory exists by creating it recursively.',
      inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema)
    },
    {
      name: 'delete_file',
      description: 'Delete a file.',
      inputSchema: zodToJsonSchema(DeleteFileArgsSchema)
    },
    {
      name: 'delete_directory',
      description: 'Delete a directory.',
      inputSchema: zodToJsonSchema(DeleteDirectoryArgsSchema)
    },
    {
      name: 'list_directory',
      description: 'List files and directories within a path.',
      inputSchema: zodToJsonSchema(ListDirectoryArgsSchema)
    },
    {
      name: 'list_directory_with_sizes',
      description: 'List directory contents with sizes and summary.',
      inputSchema: zodToJsonSchema(ListDirectoryWithSizesArgsSchema)
    },
    {
      name: 'list_directory_detailed',
      description: 'List directory contents with metadata as JSON.',
      inputSchema: zodToJsonSchema(ListDirectoryDetailedArgsSchema)
    },
    {
      name: 'directory_tree',
      description: 'Return a JSON tree of files and directories.',
      inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema)
    },
    {
      name: 'move_file',
      description: 'Move or rename files or directories.',
      inputSchema: zodToJsonSchema(MoveFileArgsSchema)
    },
    {
      name: 'copy_file',
      description: 'Copy files or directories. Supports recursive copies.',
      inputSchema: zodToJsonSchema(CopyFileArgsSchema)
    },
    {
      name: 'search_files',
      description: 'Recursive search for files and directories matching a pattern.',
      inputSchema: zodToJsonSchema(SearchFilesArgsSchema)
    },
    {
      name: 'search_text',
      description: 'Search for text matches inside files under a path.',
      inputSchema: zodToJsonSchema(SearchTextArgsSchema)
    },
    {
      name: 'get_file_info',
      description: 'Retrieve metadata about a file or directory.',
      inputSchema: zodToJsonSchema(GetFileInfoArgsSchema)
    },
    {
      name: 'collect_ide_plugins',
      description: 'Aggregate IDE plugin configurations grouped by location based on config.json files.',
      inputSchema: zodToJsonSchema(CollectIDEPluginsArgsSchema)
    },
    {
      name: 'git_info',
      description: 'Return git repository info for a path (branch, upstream, remotes).',
      inputSchema: zodToJsonSchema(GitInfoArgsSchema)
    },
    {
      name: 'git_status',
      description: 'Return git status (staged/unstaged/untracked/conflicted) for a repository path.',
      inputSchema: zodToJsonSchema(GitStatusArgsSchema)
    },
    {
      name: 'git_diff',
      description: 'Return a unified diff for a file (unstaged by default, staged when cached=true).',
      inputSchema: zodToJsonSchema(GitDiffArgsSchema)
    },
    {
      name: 'git_stage',
      description: 'Stage files in a repository (or stage all when files is empty).',
      inputSchema: zodToJsonSchema(GitStageArgsSchema)
    },
    {
      name: 'git_unstage',
      description: 'Unstage files in a repository (or unstage all when files is empty).',
      inputSchema: zodToJsonSchema(GitUnstageArgsSchema)
    },
    {
      name: 'git_untrack',
      description: 'Remove files from git index while keeping them on disk (git rm --cached).',
      inputSchema: zodToJsonSchema(GitUntrackArgsSchema)
    },
    {
      name: 'git_check_ignore',
      description: 'Return ignore rule matches (source/pattern/line) for paths.',
      inputSchema: zodToJsonSchema(GitCheckIgnoreArgsSchema)
    },
    {
      name: 'git_restore',
      description: 'Restore files to the last commit (discard local changes).',
      inputSchema: zodToJsonSchema(GitRestoreArgsSchema)
    },
    {
      name: 'git_commit',
      description: 'Create a commit from staged changes.',
      inputSchema: zodToJsonSchema(GitCommitArgsSchema)
    },
    {
      name: 'git_push',
      description: 'Push the current branch to a remote.',
      inputSchema: zodToJsonSchema(GitPushArgsSchema)
    },
    {
      name: 'git_pull',
      description: 'Pull from remote (fast-forward only by default).',
      inputSchema: zodToJsonSchema(GitPullArgsSchema)
    },
    {
      name: 'git_diagnose',
      description: 'Return diagnostic information about git availability in the server process.',
      inputSchema: zodToJsonSchema(GitDiagnoseArgsSchema)
    },
    {
      name: 'git_repos_overview',
      description: 'Return git status summaries for repositories under a repos root directory.',
      inputSchema: zodToJsonSchema(GitReposOverviewArgsSchema)
    },
    {
      name: 'git_identity',
      description: 'Return effective git user.name and user.email (local/global).',
      inputSchema: zodToJsonSchema(GitIdentityArgsSchema)
    },
    {
      name: 'git_set_identity',
      description: 'Configure git user.name and user.email (local or global).',
      inputSchema: zodToJsonSchema(GitSetIdentityArgsSchema)
    },
    {
      name: 'list_allowed_directories',
      description: 'Return the directories that the server is permitted to access.',
      inputSchema: { type: 'object', properties: {}, required: [] }
    }
  ];
}
