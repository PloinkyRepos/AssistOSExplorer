# Scope

AchillesIDE provides the Explorer workspace shell and its coupled domain agents. Explorer owns navigation, preview, editing, runtime plugin hosting, and filesystem MCP operations. Domain agents own their protected state, authorization, and domain mutations.

## Mandatory Reading Order

1. Read `README.md` and the applicable local `CLAUDE.md`.
2. Read `docs/index.html`, `docs/wiki.html`, and `docs/specs/matrix.md`.
3. Read `docs/specs/DS001-coding-style.md` before changing source layout, UI, or tests.
4. Read the relevant design specification before changing an interface, workflow, or runtime boundary.
5. Read the owning agent's local guidance and documentation before changing an agent-owned feature.

## Current Skill Catalog

This repository consumes local authoring skills from `.agents/skills/`. They guide repository work but are not AchillesIDE product features. Downstream projects that consume a skill must keep skill-specific documentation inside the imported skill folder rather than adding skill pages or DS files to the host project's `docs/` tree.

## Repository Rules

- The design specifications under `docs/specs/` are the source of truth for repository contracts.
- Keep DS numbering gap-free. Every DS file must use only `title` and `summary` frontmatter and the `Introduction`, `Core Content`, and `Conclusion` structure.
- Keep documentation, specifications, and comments in English. When code changes alter behavior, interfaces, architecture, workflows, or constraints, update the relevant HTML documentation and DS files in the same change.
- Use the WebSkel component and presenter lifecycle for Explorer UI changes. Reuse Explorer tokens, controls, icons, and modal behavior before adding local UI primitives. Keep local CSS limited to feature-specific layout and responsive behavior.
- Derive authorization from verified Ploinky invocation or router context. Do not trust client-declared actors, duplicate agent ACL policy in Explorer, expose secrets, or hardcode workstation paths.
- Run `detect-main-behaviors` before changing `DS003-main-behavior.md` and whenever a product change affects a central user outcome, essential interface, broad subsystem, or runtime boundary.
- Use one primary page-navigation model. Multi-page agent documentation lists its explanatory pages in the sidebar and keeps only the `Reference` submenu with `Wiki` and `Specifications` in the header. Single-page agent documentation uses the sidebar for section anchors and the same header-only reference submenu. Explorer's root documentation may group its page destinations in header submenus because it does not use the agent-page sidebar as a parallel page menu.

## Runtime Defaults

Explorer runs as the static Ploinky agent. Use `ploinky start explorer` for the supported local startup path. Explorer uses configured workspace roots and the router-authenticated application route; direct local agent ports are not the browser contract. See `docs/specs/DS002-ploinky-runtime.md` for the runtime boundary.

## Key Paths

- `explorer/` — Explorer browser and server implementation.
- `dpuAgent/` — confidential data, secrets, research-data, and provenance services.
- `docs/index.html` — documentation entry point.
- `docs/wiki.html` — canonical terminology page.
- `docs/specs/` — normative design specifications.
- `explorer/tests/` and `<agent>/tests/` — agent-owned tests.
