# DS05 - Global Application Plugin Surface

## Summary

Explorer provides a dedicated global application plugin surface in `#file-exp` for persistent floating UI extensions such as assistant chat launchers.

## Scope

This specification defines only the host contract for global application plugin mounts. It does not define the domain logic implemented by individual plugins.

## Host Slot Contract

- Slot name: `file-exp:global`
- Category: `application`
- Contribution type: `mount`
- Supported plugin type: `global`

The global slot is distinct from:

- `file-exp:toolbar`
- `file-exp:right-bar`
- `file-exp:internal`

## Behavioral Requirements

1. Explorer must discover and normalize plugins targeting `file-exp:global` through the same runtime discovery pipeline used for other application slots.
2. Explorer must mount global plugins in a dedicated overlay host container and preserve deterministic ordering.
3. Global slot lifecycle (mount, rerender, cleanup) must follow the same plugin settings and runtime policy gates as other application mounts.
4. The host overlay container must not block pointer events globally; only mounted plugin components may capture interaction.
5. Global plugin cleanup must run when `file-exp` unloads.
6. An application plugin declaring `adminOnly: true` must not be mounted for a non-admin user. Hiding controls inside the plugin is not an authorization substitute; its data sources must enforce their own admin boundary as well.

## Validation Rules

1. `type: "global"` is valid only for application mount contributions.
2. Menu contributions must not declare plugin `type`.
3. Document plugins must not use `type: "global"`.

## Rationale

Global surfaces enable workspace-level floating interactions without coupling those interactions to toolbar width, side panel constraints, or document preview composition. This keeps Explorer as the host shell while preserving plugin ownership boundaries.
