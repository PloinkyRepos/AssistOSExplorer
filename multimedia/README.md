# multimedia

Explorer plugin pack for media creation, upload, and preview.

## Scope

This package is not a standalone MCP agent. It is a lightweight Explorer extension bundle loaded from `IDE-plugins`.

## Included plugins

- `audio-creator`
- `audio-plugin`
- `document-video-preview`
- `ffmpeg-image-to-video`
- `image-creator`
- `image-plugin`
- `paragraph-video-preview`
- `video-creator`
- `video-plugin`

Shared helpers live in [IDE-plugins/utils](./IDE-plugins/utils).

## Plugin model

- creators and previews are mostly `embedded`
- editing actions on chapter or paragraph content are mostly `modal`
- plugin metadata is defined per plugin in `config.json`

## Runtime

[manifest.json](./manifest.json) declares a `lite-sandbox` package with no dedicated agent process. Explorer reads the plugin assets directly from this repository.
