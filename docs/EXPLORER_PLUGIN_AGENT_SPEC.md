# Explorer Agent And Plugin Spec

## Purpose

This document defines the correct ownership boundaries and integration rules for agents, runtime plugins, and UI components used by Explorer.

Use it when adding:

- a new MCP agent consumed by Explorer
- a new runtime plugin under `IDE-plugins/`
- a new embedded or modal component rendered inside Explorer
- a host integration between Explorer and another domain agent

The goal is to keep Explorer generic and keep domain logic self-contained.

## Core Rule

Explorer is a host and orchestrator.

Domain-specific behavior must live in the agent or plugin that owns that domain.

Examples:

- Git UI belongs to the Git agent/plugin, not to Explorer pages.
- DPU comments UI belongs to `dpuAgent`, not to `file-exp`.
- SOPLang document tooling belongs to the SOPLang repo, not to Explorer core.

Explorer may:

- provide mount points
- pass small host context
- react to events
- manage layout and navigation

Explorer must not:

- own domain-specific markup/styles when that domain already has its own agent
- duplicate business rules from other agents
- become the permanent home for “temporary” domain UI

## Ownership Model

### Explorer Owns

- file tree, navigation, sorting, search
- generic preview shell and layout
- generic document/editor hosting
- runtime plugin loading
- global application slots such as toolbar and right bar
- neutral UI infrastructure

### Domain Agents Own

- MCP tool contracts
- permission and storage logic
- domain-specific UI components
- domain-specific styles
- domain-specific mutations and refresh flows

## Integration Pattern

When a domain agent needs UI inside Explorer, use this pattern:

1. The domain agent publishes a runtime component in its own `IDE-plugins/` folder.
2. Explorer loads the component through runtime component registration.
3. Explorer mounts the component in a narrow host slot or mount point.
4. Explorer passes only the minimum host context required.
5. The component emits events back to Explorer for host synchronization.

Preferred data flow:

- Explorer -> component: host context
- component -> agent tools: domain reads/writes
- component -> Explorer: UI state events

Avoid this flow:

- Explorer -> agent tools -> render domain HTML itself

That creates hidden ownership drift and tightly couples Explorer pages to agent internals.

## Runtime Plugin Rules

### Public UI Plugins

Use a normal application or document plugin when the component should appear through regular plugin discovery.

Examples:

- toolbar button
- document plugin
- right sidebar plugin

### Internal Hosted Components

If the component should be mounted only by Explorer code and not shown automatically in a public slot, publish it as an application runtime plugin on an internal slot.

Recommended internal slot naming:

- `domain:internal`

Examples:

- `dpu:internal`
- `git:internal`

This allows Explorer to register the component via runtime plugin loading without auto-mounting it in visible plugin bars.

## Component Contract Rules

Hosted components should receive only compact host context.

Good host context:

- object IDs
- selected path
- booleans such as open/readonly
- lightweight current state snapshots when useful

Bad host context:

- large HTML strings
- copied domain business logic results that the component can fetch itself
- ad-hoc callback references

Preferred component API:

- attributes for stable primitive inputs
- presenter method such as `updateHostContext(...)` for updates
- bubbling `CustomEvent`s for output

Recommended event style:

- `domain-feature-state`
- `domain-feature-close`
- `domain-feature-request`

Event payloads should be plain JSON-like objects.

## Styling Rules

If a component belongs to a domain agent, its CSS belongs with that component.

Explorer CSS should only style:

- the host container
- generic layout concerns
- spacing constraints required by the page shell

Do not place domain card styles, button variants, or domain panel internals in `file-exp.css` unless the component is truly Explorer-owned.

## Tooling Rules

Domain UI components should call the domain agent tools directly when they need domain reads or mutations.

Explorer should not proxy every domain action unless there is a generic host-level reason.

Examples of valid reasons for Explorer mediation:

- navigation
- preview mode switching
- generic caching or invalidation at page level
- shared error presentation

Examples of invalid reasons:

- “it was faster to put the call in Explorer”
- “the UI is already mounted there”

## Preview Integration Rules

For file preview integrations:

- Explorer owns the preview shell.
- Domain agents may own side panels, popovers, or embedded widgets inside that shell.
- The preview shell should mount a domain component, not construct its DOM manually.

If the UI is sidecar-like:

- Explorer creates the mount point.
- Domain component renders itself inside that mount.

If the UI is deeply domain-specific:

- avoid storing the rendering logic in `file-exp-preview-renderer.js`

## Mutation And Refresh Rules

After a domain component performs a mutation:

1. the component refreshes its own state from source of truth
2. the component emits a state event to Explorer
3. Explorer updates only the host-level state it owns

Do not force full page reloads when a local state event is enough.

## Good Example

DPU comments for confidential files:

- DPU owns comment permission semantics and comment UI
- Explorer owns the preview shell and the button that toggles the sidecar
- Explorer mounts `dpu-comments-popover`
- `dpu-comments-popover` calls DPU tools directly
- `dpu-comments-popover` emits comment count/state changes
- Explorer updates header badges and open/close state

## Bad Example

Explorer page builds DPU comments HTML itself:

- DPU semantics leak into Explorer renderer
- DPU CSS leaks into `file-exp.css`
- future DPU UI changes require editing Explorer core
- ownership becomes unclear

## Checklist Before Merging

Use this checklist for every new agent/plugin integration:

- Does the owning domain repo contain the UI component?
- Does Explorer only host and orchestrate it?
- Is the component discoverable through runtime plugin loading?
- If it is internal-only, does it use an internal slot such as `domain:internal`?
- Are styles colocated with the component?
- Are business mutations executed by the owning agent tools?
- Is the host/component contract explicit and small?
- Are component outputs emitted through bubbling events?
- Would another developer know which repo owns the feature after reading the code?

If any answer is “no”, the integration is probably too coupled.
