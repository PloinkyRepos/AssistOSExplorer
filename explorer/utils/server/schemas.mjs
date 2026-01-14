export function createSchemas(z) {
  const ReadTextFileArgsSchema = z.object({
    path: z.string(),
    tail: z.number().optional().describe('If provided, returns only the last N lines of the file'),
    head: z.number().optional().describe('If provided, returns only the first N lines of the file')
  });
  const ReadMediaFileArgsSchema = z.object({ path: z.string() });
  const ReadMultipleFilesArgsSchema = z.object({ paths: z.array(z.string()) });
  const WriteFileArgsSchema = z.object({ path: z.string(), content: z.string() });
  const WriteBinaryFileArgsSchema = z.object({
    path: z.string(),
    content: z.string().describe('Base64-encoded binary content'),
    encoding: z.enum(['base64']).optional().default('base64')
  });
  const EditOperation = z.object({ oldText: z.string(), newText: z.string() });
  const EditFileArgsSchema = z.object({ path: z.string(), edits: z.array(EditOperation), dryRun: z.boolean().default(false) });
  const CreateDirectoryArgsSchema = z.object({ path: z.string() });
  const DeleteFileArgsSchema = z.object({ path: z.string() });
  const DeleteDirectoryArgsSchema = z.object({ path: z.string() });
  const ListDirectoryArgsSchema = z.object({ path: z.string() });
  const ListDirectoryWithSizesArgsSchema = z.object({ path: z.string(), sortBy: z.enum(['name', 'size']).optional().default('name') });
  const ListDirectoryDetailedArgsSchema = z.object({ path: z.string() });
  const DirectoryTreeArgsSchema = z.object({
    path: z.string(),
    maxDepth: z.number().int().positive().max(100).optional(),
    maxNodes: z.number().int().positive().max(20000).optional()
  });
  const MoveFileArgsSchema = z.object({ source: z.string(), destination: z.string() });
  const CopyFileArgsSchema = z.object({
    source: z.string(),
    destination: z.string(),
    overwrite: z.boolean().optional().default(false)
  });
  const SearchFilesArgsSchema = z.object({
    path: z.string(),
    pattern: z.string(),
    excludePatterns: z.array(z.string()).optional().default([]),
    maxResults: z.number().int().positive().max(20000).optional().default(5000)
  });
  const SearchTextArgsSchema = z.object({
    path: z.string(),
    query: z.string(),
    caseSensitive: z.boolean().optional().default(false),
    maxResults: z.number().int().positive().max(5000).optional().default(200),
    excludePatterns: z.array(z.string()).optional().default([])
  });
  const GetFileInfoArgsSchema = z.object({ path: z.string() });
  const CollectIDEPluginsArgsSchema = z.object({});
  const GitInfoArgsSchema = z.object({ path: z.string() });
  const GitStatusArgsSchema = z.object({ path: z.string() });
  const GitDiffArgsSchema = z.object({
    path: z.string(),
    file: z.string(),
    cached: z.boolean().optional().default(false),
    ref: z.string().optional().nullable().default(null).describe('Optional base ref for diff (e.g. "HEAD"). When set, diff is working tree vs ref.')
  });
  const GitStageArgsSchema = z.object({
    path: z.string(),
    files: z.array(z.string()).optional().default([])
  });
  const GitUnstageArgsSchema = z.object({
    path: z.string(),
    files: z.array(z.string()).optional().default([])
  });
  const GitUntrackArgsSchema = z.object({
    path: z.string(),
    files: z.array(z.string()).optional().default([])
  });
  const GitCheckIgnoreArgsSchema = z.object({
    path: z.string(),
    files: z.array(z.string()).optional().default([])
  });
  const GitRestoreArgsSchema = z.object({
    path: z.string(),
    files: z.array(z.string()).optional().default([])
  });
  const GitConflictVersionsArgsSchema = z.object({
    path: z.string(),
    file: z.string()
  });
  const GitCheckoutConflictArgsSchema = z.object({
    path: z.string(),
    file: z.string(),
    source: z.enum(['ours', 'theirs'])
  });
  const GitStashArgsSchema = z.object({
    path: z.string(),
    includeUntracked: z.boolean().optional().default(true),
    message: z.string().optional().default('')
  });
  const GitStashPopArgsSchema = z.object({
    path: z.string(),
    ref: z.string().optional().nullable().default(null),
    reinstateIndex: z.boolean().optional().default(true)
  });
  const GitCommitArgsSchema = z.object({
    path: z.string(),
    message: z.string().optional().default(''),
    amend: z.boolean().optional().default(false),
    signoff: z.boolean().optional().default(false)
  });
  const GitPushArgsSchema = z.object({
    path: z.string(),
    remote: z.string().optional().nullable().default(null),
    branch: z.string().optional().nullable().default(null),
    setUpstream: z.boolean().optional().default(false),
    token: z.string().optional().nullable().default(null).describe('Optional HTTPS Personal Access Token used for pushing non-interactively.')
  });
  const GitPullArgsSchema = z.object({
    path: z.string(),
    remote: z.string().optional().nullable().default(null),
    branch: z.string().optional().nullable().default(null),
    rebase: z.boolean().optional().default(false),
    ffOnly: z.boolean().optional().default(true),
    token: z.string().optional().nullable().default(null).describe('Optional HTTPS Personal Access Token used for pulling non-interactively.')
  });
  const GitDiagnoseArgsSchema = z.object({ path: z.string() });
  const GitIdentityArgsSchema = z.object({ path: z.string() });
  const GitSetIdentityArgsSchema = z.object({
    path: z.string(),
    scope: z.enum(['local', 'global']).optional().default('local'),
    name: z.string(),
    email: z.string()
  });
  const GitReposOverviewArgsSchema = z.object({
    path: z.string(),
    maxRepos: z.number().int().positive().max(500).optional().default(200)
  });

  return {
    ReadTextFileArgsSchema,
    ReadMediaFileArgsSchema,
    ReadMultipleFilesArgsSchema,
    WriteFileArgsSchema,
    WriteBinaryFileArgsSchema,
    EditOperation,
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
    GitConflictVersionsArgsSchema,
    GitCheckoutConflictArgsSchema,
    GitStashArgsSchema,
    GitStashPopArgsSchema,
    GitCommitArgsSchema,
    GitPushArgsSchema,
    GitPullArgsSchema,
    GitDiagnoseArgsSchema,
    GitIdentityArgsSchema,
    GitSetIdentityArgsSchema,
    GitReposOverviewArgsSchema
  };
}
