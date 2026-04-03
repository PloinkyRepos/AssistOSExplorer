# GA02 - Git Explorer Plugin

## Summary

The `git-tool-button` plugin is the Explorer entry point for Git workflows. It is mounted in the `file-exp:toolbar` application slot.

## Plugin Registration

According to [config.json](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/gitAgent/IDE-plugins/git-tool-button/config.json):

- `pluginCategory`: `application`
- `id`: `git`
- `location`: `file-exp:toolbar`
- `component`: `git-tool-button`

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
- the current host context
- generic page refresh events

The Git plugin owns:

- repository selection
- stage/unstage state
- commit, pull, push, and sync flows
- Git authentication prompts
- conflict resolution UI

## Behavioral Specification

1. Explorer loads the runtime plugin into the toolbar slot.
2. The plugin reads the current Explorer context and selected repository state.
3. The plugin calls `gitAgent` over MCP for repository operations.
4. Credentials UI may capture a manual token or start GitHub device flow, but the token itself is persisted server-side in DPU Secrets.
5. The plugin emits refresh and close events back to Explorer after Git operations complete.

## Interaction Model

The plugin follows the Explorer presenter model and uses WebSkel as the UI framework.

- Click actions are declared with `data-local-action` and dispatched through presenter methods.
- Form-oriented events that WebSkel does not dispatch natively, such as `input`, `change`, and selected `keydown` flows, are handled through delegated listeners attached once at component root level.
- The plugin must not bind listeners repeatedly to individual controls during rerender cycles.
- Pointer-drag and scroll synchronization behaviors may still use direct DOM listeners because they model low-level browser interaction rather than presenter actions.

## Related Specs

- [GA01 - Git Agent Overview](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/gitAgent/docs/specs/GA/GA01-agent-overview.md)
