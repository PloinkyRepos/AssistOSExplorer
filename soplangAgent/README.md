# soplangAgent internals

This agent exposes explicit MCP tools through `mcp-config.json` and executes them through `soplang-tool.sh`.

## Structure

- `plugins/SoplangBuilder.js`
  Thin plugin wrapper. Delegates to `plugins/lib/soplangBuilderCore.mjs`.
- `plugins/AchillesSkills.js`
  Thin bridge wrapper. Delegates to `plugins/lib/achillesSkillsCore.mjs`.
- `plugins/lib/soplangBuilderCore.mjs`
  Main orchestration for `sync_markdown_documents`, `execute_incremental_build`, `execute_workspace_build`, `build_from_specs_markdown`, and `get_variables_with_values`.
- `plugins/lib/workspaceRoots.mjs`
  Workspace root detection and markdown file walking.
- `plugins/lib/markdownMetadata.mjs`
  Markdown metadata parsing for `achilles-ide-*` comments.
- `plugins/lib/builderCommands.mjs`
  Custom SOPLang command registration (`load`, `createJSCode`, `store`).
- `plugins/lib/achillesSkillsCore.mjs`
  Skill discovery/registration bridge and `execute_skill` behavior.
- `plugins/lib/toolInvocation.mjs`
  MCP tool name to plugin method mapping used by the wrapper.
- `tests/soplangBuilder.test.mjs`
  Core flow tests plus MCP wrapper mapping/preflight tests.

## Root selection

`pickWorkspaceRoot()` resolves roots in a strict order:

1. `SOPLANG_WORKSPACE_ROOT`, if set
2. `PLOINKY_CWD`, if set
3. current working directory
4. parent directory
5. grandparent directory

If `SOPLANG_WORKSPACE_ROOT` is set but invalid, the agent now fails fast instead of silently falling back.

When running inside Ploinky, markdown scanning starts from the workspace root and includes `/.ploinky/repos/**`. It still skips infrastructure directories such as `node_modules`, `.git`, `agents`, `logs`, `blobs`, and `shared`.

## Tests

Run:

```sh
npm test
```

Coverage currently includes:

- `sync_markdown_documents`
- `execute_incremental_build`
- `execute_workspace_build`
- `build_from_specs_markdown`
- `get_variables_with_values`
- `execute_skill`
- MCP wrapper tool mapping and preflight validation

## Documentation

- [SA01 - SOPLang Agent Overview](./docs/specs/SA/SA01-agent-overview.md)
