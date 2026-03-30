# soplang

Explorer plugin pack for SOPLang-aware document actions.

## Scope

This package is not a standalone MCP agent. It contributes UI plugins that Explorer loads from `IDE-plugins`.

## Included plugins

- `edit-variables`
- `run-script`

## Behavior

- `edit-variables` is an embedded document plugin available on document, chapter, and paragraph contexts
- `run-script` is a modal action exposed on `infoText`

Both plugin definitions are declared in their local `config.json` files.

## Runtime

[manifest.json](./manifest.json) marks the package as `lite-sandbox`. There is no separate MCP server in this folder.
