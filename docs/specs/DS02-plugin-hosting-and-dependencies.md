# DS02 - Plugin Hosting And Dependencies

## Summary

Explorer is the host shell for runtime plugins and dependent MCP agents. The core rule is that Explorer owns the IDE shell, while dependent agents own their domain logic, domain state, and domain-specific UI components.

## Background / Problem Statement

Explorer integrates multiple domain systems inside one IDE surface:

- Git workflows
- DPU-backed confidential resources
- SOPLang build flows
- task management
- LLM-assisted flows

Without a clear hosting model, Explorer would gradually absorb domain logic directly into `file-exp`, which would:

- increase coupling
- duplicate agent responsibilities
- make plugin integration brittle
- make the IDE shell harder to evolve

## Goals

1. Define clear ownership boundaries between Explorer and dependent agents
2. Document how runtime plugins are mounted into the host shell
3. Preserve stable plugin ordering and predictable slot behavior
4. Keep the IDE shell extensible without hard-coding domain UI everywhere
5. Make failure and recovery behavior explicit when dependencies are unavailable

## Non-Goals

- reimplementing Git, DPU, Tasks, SOPLang, or LLM workflows in Explorer core
- turning Explorer into a generic proxy for all domain mutations
- allowing plugins to override host navigation, layout, or routing contracts arbitrarily
- treating plugins as standalone mini-apps with no host coordination

## Architecture Overview

Explorer plugin hosting is a layered contract:

```text
Explorer IDE shell
  -> runtime plugin registry
    -> slot resolution
      -> plugin presenter/component mount
        -> MCP calls to owning domain agent
          -> host refresh or layout update
```

The architecture is intentionally split so that:

- Explorer owns layout, selection, preview shell, and navigation
- runtime plugins render domain affordances inside defined slots
- dependent agents execute domain-specific reads and writes
- the host shell reacts to domain mutations without taking over their logic

## Data Models

### Agent-Owned Plugin Bundles

The `AchillesIDE` repository currently keeps runtime plugins in agent-owned directories such as:

- `dpuAgent/IDE-plugins`
- `gitAgent/IDE-plugins`
- `multimedia/IDE-plugins`
- `soplangAgent/IDE-plugins`
- `tasksAgent/IDE-plugins`

Each owning agent is responsible for:

- plugin manifests (`config.json`)
- plugin assets
- reusable agent-local plugin utilities
- shared subcomponents used by its plugin set

Explorer must discover plugins across these agent-owned roots. The hosting contract is centralized in Explorer, but the plugin source code is intentionally split by ownership instead of forced into a single `explorer/IDE-plugins` directory.

When Explorer runs inside Ploinky box, its manifest must mount the workspace `.ploinky/repos` tree at `/workspace/.ploinky/repos` so the plugin discovery pipeline can see enabled sibling repositories such as `basic`. This mount is read as workspace-owned runtime configuration; it lets agent-owned settings dashboards be discovered without copying their files into `explorer`.

### Plugin Inventory

According to [manifest.json](../../explorer/manifest.json), Explorer activates plugins such as:

- `git`
- `dpu-runtime-support`
- `soplang-builder`
- `tasks`

These plugins should be understood as IDE extensions mounted into Explorer, not as independent applications embedded without coordination.

### Host Slots

Examples of host slots used by integrations:

- `file-exp:toolbar`
- `file-exp:global`
- `file-exp:account-menu`
- `file-exp:context-menu:file`
- `file-exp:context-menu:directory`
- `file-exp:copilot-launch-extension`
- `file-exp:new-menu`
- preview-shell mount points
- modal mount points
- side-panel mount points

The host slot model exists to avoid hard-coding domain UI directly inside Explorer core. Explorer owns the slot contract, while plugins own their rendered content and event behavior.

`file-exp:copilot-launch-extension` is a metadata slot, not a visible UI
mount. Agent-owned plugins may use it to contribute extra query parameters for
the normal Copilot WebChat launcher. The Copilot launcher consumes those
parameters generically; Explorer core must not hard-code the contributing
agent, tag names, or downstream tool names. Domain-specific chat routing must
remain in the contributing agent and in the selected Copilot agent's generic
launch/configuration handling.

### Contribution Types

Explorer supports two application plugin contribution types:

- `mount`: the plugin renders a WebSkel component inside a host-owned slot such as `file-exp:toolbar`
- `menu`: the plugin contributes semantic menu items into a host-owned menu surface such as a file context menu or the `New` menu

For `mount` contributions, Explorer supports these plugin `type` values:

- `embedded`: component mounted inside bounded shell containers such as toolbar or right bar
- `modal`: component assets mounted as host-driven modal surfaces
- `global`: component mounted in the dedicated `file-exp:global` overlay slot for persistent floating workspace affordances

Workspace plugin settings must treat both contribution types as first-class configurable plugins. A `menu` contribution is not coupled to a `mount` contribution for enable or disable behavior.

Runtime plugin policy keys must be explicit and stable:

- application plugins use `agent/id`
- document plugins use `agent/component`

Explorer must not infer policy identity through fallback chains or ad hoc surface-specific rules.

When one logical application plugin contributes multiple surfaces, those contributions must share the same application plugin `id`. For example, a toolbar mount and its menu contributions remain one plugin for policy and settings purposes.

Menu contributions are not arbitrary DOM mounts. Explorer owns the rendered menu structure and interaction model, while plugins contribute:

- menu item metadata
- visibility logic
- action execution through the owning agent

When Explorer resolves plugin menu items for a concrete filesystem target, the resulting item payload must retain that target identity (`entryPath`, `entryType`, `entryName`). Action execution must use the same target context that was used for item resolution, instead of reconstructing a fresh target later from unrelated UI state.

When workspace plugin settings change, Explorer must invalidate cached menu contributions and re-resolve host-owned menu surfaces from current plugin policy instead of continuing to render stale items.

### Ownership Model

| Dependency | Explorer owns | Dependency owns |
|---|---|---|
| `gitAgent` | toolbar slot, host refresh, repo context | Git workflows, commit modal, repo tree, credentials |
| `dpuAgent` | confidential navigation shell, preview host | storage, ACL, comments, confidential object logic |
| `soplangAgent` | explicit SOPLang tag-edit action and document context | build logic, markdown sync, skills bridge |
| `tasksAgent` | toolbar slot and document context | backlog CRUD, conflict handling, task UI |

This ownership table is an architectural guardrail. If Explorer starts duplicating domain behavior from these agents, the design has drifted.

Ordinary `.md` source editing is not a `soplangAgent` responsibility. Explorer owns the default Markdown editor surface and its save lifecycle. `soplangAgent` participates only when the user enters SOPLang-aware workflows such as tag editing, document synchronization, build execution, variables, or command processing.

### Ordering Model

Plugin placement must remain stable across enable, disable, and refresh flows.

Explorer therefore relies on:

- deterministic plugin discovery
- deterministic slot sorting
- explicit or derived ordering rules
- DOM reordering when plugins are remounted

The user should perceive plugin availability changes as additive or subtractive, not as random layout reshuffling.

## API Contracts

### Host-to-Plugin Contract

Explorer provides:

- stable slot names
- mounting surfaces
- host-owned account menu surfaces
- host-owned menu surfaces
- host layout and navigation context
- host refresh points after mutations

Plugins are expected to:

- render only within approved host slots
- contribute menu items semantically instead of injecting arbitrary menu DOM
- call their owning agent through MCP or domain-specific host bridges
- emit host-facing events instead of mutating host state ad hoc

For filesystem-oriented menu actions, the host context must include both:

- the Explorer path used by shell navigation
- the absolute filesystem path used for dependent agent calls

Plugins should consume the explicit filesystem target supplied by the host context instead of guessing the workspace root or translating Explorer paths on their own.

For `file-exp:new-menu`, the host context must expose the current directory in both host and filesystem form:

- `currentPath`
- `currentDirectory`
- `currentFsPath`

### Plugin-to-Agent Contract

The intended integration path is:

1. Explorer mounts the plugin component
2. The plugin calls its owning agent through MCP
3. The agent returns domain data or completes a mutation
4. The plugin asks the host to refresh layout or visible state

Explorer should not be required to understand the internal domain model behind every plugin action.

## Behavioral Specification

### Preferred Flow

1. Explorer mounts the domain component
2. The component calls its agent through MCP
3. The component emits events back to the host
4. Explorer updates layout, navigation, selection, or preview state

Examples of acceptable host responsibilities:

- refreshing `file-exp` layout after a plugin-triggered mutation
- preserving selection, URL, and preview state
- hosting modals and side panels
- coordinating toolbar affordances
- mounting workspace-control plugins inside the account menu while keeping account menu structure host-owned
- rendering context menus and `New` menus while delegating domain actions to plugins or owning agents
- showing a host-owned loading state while async menu contributions are still being resolved

Examples of unacceptable host responsibilities:

- reimplementing Git operations in Explorer core
- reimplementing DPU permission logic in Explorer core
- hard-coding task domain state into `file-exp`
- delegating menu layout and focus behavior to plugin-specific DOM fragments

### Failure And Recovery Expectations

When a dependency is unavailable, Explorer should degrade gracefully:

- keep the host shell responsive
- avoid corrupting local IDE state
- surface actionable error messages
- recover automatically when the dependency becomes available again

This is important for IDE behavior because a user may still be navigating, reading, or editing unrelated resources while one plugin or one dependent agent is unavailable.

### Rejected Flow

Explorer must not:

- reimplement domain tool logic
- generate domain HTML manually when a dedicated plugin already exists
- become the mandatory proxy for every domain mutation

## Configuration

Plugin hosting behavior is primarily driven by:

- Explorer `manifest.json` application plugin policy
- enabled agents and repo-local agent/plugin folders in the workspace
- the manifest volume that makes `.ploinky/repos` visible to the Explorer container
- runtime plugin settings and activation state
- slot ordering rules applied by the host shell

The host shell must remain deterministic even when plugin availability changes between sessions or after refresh.

## Related Specs

- [DS01 - Explorer System Overview](./DS01-system-overview.md)
- [DS03 - Confidential Files And DPU](./DS03-confidential-files-and-dpu.md)
- [DS05 - Global Application Plugin Surface](./DS05-global-application-plugin-surface.md)
- [gitAgent plugin spec](../../gitAgent/docs/specs/DS02-explorer-plugin.md)
- [tasksAgent plugin spec](../../tasksAgent/docs/specs/DS04-Explorer-Integration-and-IDE-Plugin-Channel.md)
