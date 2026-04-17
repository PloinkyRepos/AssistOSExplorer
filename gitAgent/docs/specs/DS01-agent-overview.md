# DS01 - Git Agent Overview

## Summary

`gitAgent` is the Model Context Protocol (MCP) agent responsible for workspace-scoped Git operations and for the Git user experience exposed through Explorer.

## Background / Problem Statement

Explorer needs Git capabilities without binding the user interface (UI) directly to shell commands, repository discovery rules, authentication handling, or per-repository operational logic. `gitAgent` provides that boundary.

## Goals

1. Expose Git operations through Model Context Protocol (MCP) tools that are safe to call from Explorer.
2. Restrict Git operations to valid workspace repository roots.
3. Centralize Git authentication, repository status inspection, commit/push/pull flows, and conflict support.
4. Keep sensitive credentials out of browser storage.

## Non-Goals

- Acting as a general-purpose Git client for arbitrary paths outside the workspace.
- Moving the Git user interface (UI) into Explorer core.
- Treating browser storage as a source of truth for access tokens.

## Architecture Overview

| Area | Responsibility |
|---|---|
| `tools/git_tool.sh` + `tools/git_tool.mjs` | MCP tool dispatch and request orchestration |
| `lib/git-service.mjs` | low-level Git execution and repository operations |
| `lib/github-auth.mjs` | GitHub device flow, auth status, metadata persistence |
| `lib/secret-store-client.mjs` | generic `secret-store/v1` client (router-mediated, signed caller assertion) |
| `IDE-plugins/git-tool-button/` | Explorer-facing Git UI plugin |

## Authentication Model

`gitAgent` supports two user-facing authentication modes:

1. GitHub device flow
2. Manual token entry

Both modes persist the effective token in DPU Secrets, not in browser `localStorage`.

### Token persistence rules

- There is a single GitHub token secret per user.
- The secret is stored in DPU using a stable key managed by `gitAgent`.
- Browser storage may keep non-sensitive UI metadata, such as the selected auth method or GitHub profile metadata, but not the token itself.
- Local state in `.ploinky/state/git-agent-github-auth.json` may keep non-sensitive connection metadata and pending device-flow state, but not the token value.

## Application Programming Interface Contracts

Primary tools include:

- `git_info`
- `git_status`
- `git_diff`
- `git_commit`
- `git_push`
- `git_pull`
- `git_stash`
- `git_commit_message`
- `git_auth_status`
- `git_auth_begin`
- `git_auth_poll`
- `git_auth_disconnect`
- `git_auth_store_token`

## Behavioral Specification

1. Explorer invokes `gitAgent` MCP tools for repository inspection and operations.
2. `gitAgent` resolves and validates repository paths against the workspace.
3. `git_info` accepts file or directory targets and returns both the repository root and the repository-relative path for the selected target.
4. For authenticated remote operations, `gitAgent` uses:
   - `metadata.authInfo.github.accessToken` when already supplied by the caller, otherwise
   - the per-user token stored in DPU Secrets.
5. GitHub device-flow completion writes the token into DPU and keeps only metadata in local state.
6. Manual token save writes the token into DPU and updates local connection metadata with a non-sensitive source marker.
7. Disconnect removes the per-user token from DPU and clears local metadata.
8. Auto-stash pull handling in the Explorer Git plugin uses a single shared implementation for stash creation, pull execution, rollback restore, and stash-pop recovery. Modal and controller-specific UI flows adapt that shared result instead of duplicating Git logic.

## Configuration

Relevant variables include:

- `ASSISTOS_FS_ROOT`
- `WORKSPACE_ROOT`
- `PLOINKY_WORKSPACE_ROOT`
- `PLOINKY_GITHUB_CLIENT_ID`
- `PLOINKY_GITHUB_CLIENT_SECRET`
- `PLOINKY_GITHUB_SCOPE`

## Related Specs

- [DS02 - Explorer Plugin](./DS02-explorer-plugin.md)
