# DS02 - Git Explorer Plugin

## Summary

Git integrates with Explorer through two application plugin surfaces:

- `git-tool-button`, mounted in `file-exp:toolbar`
- `git-menu-contributions`, contributing semantic menu items to host-owned Explorer menus as part of the same logical `git` plugin

## Plugin Registration

According to [git-tool-button config](../../../IDE-plugins/git-tool-button/config.json):

- `pluginCategory`: `application`
- `id`: `git`
- `location`: `file-exp:toolbar`
- `component`: `git-tool-button`

According to [git-menu-contributions config](../../../IDE-plugins/git-menu-contributions/config.json):

- `pluginCategory`: `application`
- `contributionType`: `menu`
- `id`: `git`
- `location`: `file-exp:context-menu:file`, `file-exp:context-menu:directory`, `file-exp:new-menu`
- `menuModule`: `menu-contributions.js`

## Dependency Graph

The public plugin mounts and coordinates dependent components such as:

- `git-commit-modal`
- `git-repo-tree`
- `git-commit-actions`
- `git-commit-body`
- `git-credentials-prompt`
- `git-diff-viewer`
- `git-conflict-helper`

## Ownership Rules

Explorer owns:

- the toolbar slot
- the rendered context menu and `New` menu surfaces
- the current host context
- generic page refresh events

The Git plugin owns:

- repository selection
- stage/unstage state
- commit, pull, push, and sync flows
- Git authentication prompts
- conflict resolution user interface (UI)
- menu action semantics such as `New repository` in the host-owned Explorer `New` menu
- menu action semantics such as `Add to .gitignore` and `Remove from .gitignore`
- direct ignore actions in `git-commit-modal`, without a separate pattern-editing prompt

For ignore actions in Explorer context menus, the owning Git behavior is:

- `Add to .gitignore` appends the selected file or directory pattern to the repository `.gitignore`
- if the target is already tracked, `Add to .gitignore` removes it from the Git index, including cases where the index contains staged content that diverges from both `HEAD` and the worktree
- `Remove from .gitignore` removes the matching ignore rule and restores tracking when possible
- the file remains on disk in both cases

For the host-owned Explorer `New` menu, the owning Git behavior is:

- `New repository` asks for a repository name
- the current Explorer directory is used as the parent path
- execution creates a new child directory and initializes a Git repository inside it

## Behavioral Specification

1. Explorer mounts toolbar plugins and resolves menu contributions for host-owned menu surfaces.
2. Git UI components or Git menu modules read the current Explorer context.
3. The Git integration calls `gitAgent` over Model Context Protocol (MCP) for repository operations.
4. Credentials UI may capture a manual token or start GitHub device flow, but the token itself is persisted server-side in DPU Secrets.
5. Explorer refreshes its visible state after Git operations complete.

## Interaction Model

The plugin follows the Explorer presenter model and uses WebSkel as the UI framework.

- Click actions are declared with `data-local-action` and dispatched through presenter methods.
- Form-oriented events that WebSkel does not dispatch natively, such as `input`, `change`, and selected `keydown` flows, are handled through delegated listeners attached once at component root level.
- The plugin must not bind listeners repeatedly to individual controls during rerender cycles.
- Pointer-drag and scroll synchronization behaviors may still use direct DOM listeners because they model low-level browser interaction rather than presenter actions.

## Related Specs

- [DS01 - Git Agent Overview](./DS01-agent-overview.md)
