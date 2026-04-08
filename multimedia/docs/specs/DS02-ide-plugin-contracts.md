# DS02 - IDE Plugin Contracts

## Role of This Document

This document defines integration contracts for IDE plugins published by the `multimedia` agent.

## Requirements

Requirement U1: every published plugin must include a valid `config.json` with `pluginCategory`, `component`, `presenter`, `type`, and appropriate icon/tooltips.

Requirement U2: plugins must work in document/chapter/paragraph context using host-provided context (`data-context`).

Requirement U3: attachment-mutating actions must persist data through `document` module APIs and/or `commandsEditor`.

Requirement U4: media uploads must enforce size limits and metadata extraction (duration, dimensions), with visible UI feedback.

Requirement U5: preview plugins must support sequential scene playback with audio/video/image/silence combinations.

Requirement U6: task orchestration plugins (for example document video actions) must expose live status for async tasks.

## Constraints

Constraint Q1: plugins must not assume private host dependencies; integration must use the stable Explorer surface.

Constraint Q2: host-side visual changes must not impact attachment persistence behavior.

Constraint Q3: upload/metadata errors must be handled explicitly and surfaced with useful messages.

## Invariants

Invariant P1: the attachment data model remains serializable in `commands` / `mediaAttachments`.

Invariant P2: the upload flow is `validate -> metadata -> upload -> persist -> invalidate UI`.

Invariant P3: media plugins remain the primary value channel of the agent.
