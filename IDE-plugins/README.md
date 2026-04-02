# IDE-plugins

This directory is the canonical runtime plugin bundle for the `fileExplorer` repository.

## Scope

It contains:

- former multimedia document plugins
- former SOPLang-related document plugins
- shared plugin assets, utilities, and reusable UI subcomponents

## Runtime contract

Explorer discovers plugins from `IDE-plugins/*/config.json` and treats this directory as the local plugin source for the `fileExplorer` repository.

## Rules

- Add new repository-local runtime plugins directly under `IDE-plugins/`.
- Put reusable helpers in `IDE-plugins/utils`, `IDE-plugins/assets`, or `IDE-plugins/components`.
- Do not create secondary plugin roots under sibling folders.
