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
    maxResults: z.number().int().positive().max(20000).optional().default(5000),
    workspaceVersion: z.number().int().nonnegative().optional().default(0)
  });
  const SearchTextArgsSchema = z.object({
    path: z.string(),
    query: z.string(),
    caseSensitive: z.boolean().optional().default(false),
    useRegex: z.boolean().optional().default(false),
    wholeWord: z.boolean().optional().default(false),
    maxResults: z.number().int().positive().max(5000).optional().default(2000),
    excludePatterns: z.array(z.string()).optional().default([]),
    paths: z.array(z.string()).optional().default([]),
    workspaceVersion: z.number().int().nonnegative().optional().default(0)
  });
  const SearchTextStatusArgsSchema = z.object({
    jobId: z.string()
  });
  const SearchTextCancelArgsSchema = z.object({
    jobId: z.string()
  });
  const ReplaceTextArgsSchema = z.object({
    path: z.string(),
    query: z.string(),
    replaceWith: z.string(),
    caseSensitive: z.boolean().optional().default(false),
    useRegex: z.boolean().optional().default(false),
    wholeWord: z.boolean().optional().default(false),
    maxResults: z.number().int().positive().max(100000).optional().default(50000),
    excludePatterns: z.array(z.string()).optional().default([]),
    selectedMatchIds: z.array(z.string()).optional().default([]),
    workspaceVersion: z.number().int().nonnegative().optional().default(0),
    dryRun: z.boolean().optional().default(false)
  });
  const GetFileInfoArgsSchema = z.object({ path: z.string() });
  const LlmAutocompleteArgsSchema = z.object({
    path: z.string(),
    content: z.string(),
    cursorOffset: z.number(),
    language: z.string().optional().default('')
  });
  const CollectIDEPluginsArgsSchema = z.object({});
  const GetPluginSettingsArgsSchema = z.object({});
  const SetPluginEnabledArgsSchema = z.object({
    key: z.string(),
    enabled: z.boolean()
  });
  const ListSkillsArgsSchema = z.object({});
  const ReadSkillsManifestStateArgsSchema = z.object({ folderPath: z.string() });
  const AddSkillsManifestRepoArgsSchema = z.object({
    folderPath: z.string(),
    url: z.string(),
    name: z.string().optional().nullable(),
    branch: z.string().optional().nullable()
  });
  const SetSkillsManifestSkillEnabledArgsSchema = z.object({
    folderPath: z.string(),
    repoName: z.string(),
    skill: z.string(),
    enabled: z.boolean()
  });
  const RemoveSkillsManifestRepoArgsSchema = z.object({
    folderPath: z.string(),
    repoName: z.string()
  });
  const GetAvatarSettingsAgentsArgsSchema = z.object({});
  const UpdateAvatarSettingsAgentArgsSchema = z.object({
    agentId: z.string(),
    config: z.record(z.any())
  });
  const SetAvatarSettingsAgentVisibilityArgsSchema = z.object({
    agentId: z.string(),
    enabled: z.boolean()
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
    SearchTextStatusArgsSchema,
    SearchTextCancelArgsSchema,
    ReplaceTextArgsSchema,
    GetFileInfoArgsSchema,
    LlmAutocompleteArgsSchema,
    CollectIDEPluginsArgsSchema,
    GetPluginSettingsArgsSchema,
    SetPluginEnabledArgsSchema,
    ListSkillsArgsSchema,
    ReadSkillsManifestStateArgsSchema,
    AddSkillsManifestRepoArgsSchema,
    SetSkillsManifestSkillEnabledArgsSchema,
    RemoveSkillsManifestRepoArgsSchema,
    GetAvatarSettingsAgentsArgsSchema,
    UpdateAvatarSettingsAgentArgsSchema,
    SetAvatarSettingsAgentVisibilityArgsSchema
  };
}
