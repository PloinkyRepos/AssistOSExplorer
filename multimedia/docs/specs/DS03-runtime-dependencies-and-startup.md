# DS03 - Runtime Dependencies and Startup Install

## Role of This Document

This document defines runtime requirements for starting the `multimedia` agent and its minimum dependency guarantees.

## Runtime Contract

The agent uses this manifest:

```json
{
  "container": "docker.io/assistos/ploinky-node:24-bookworm-tools",
  "profiles": {
    "default": {
      "install": "/code/scripts/install.sh"
    }
  }
}
```

## Startup Install Requirements

Requirement R1: the install script must run at startup to prepare the multimedia runtime.

Requirement R2: in container mode, the shared Ploinky Node image must provide `git` and `ffmpeg`, and the script must validate their presence before the agent becomes available. It may fall back to package installation only when a non-standard image is used.

Requirement R3: the script must fail startup when `git` is missing from the container runtime.

Requirement R4: missing `ffmpeg` from the container runtime is an explicit warning.

## Constraints

Constraint C1: FFmpeg-dependent video processing features are not guaranteed when `ffmpeg` is missing from the runtime.

Constraint C2: runtime dependencies are supplied by the pinned container image or installed inside a compatible agent container; host packages are not part of the runtime contract.

## Invariants

Invariant I1: agent startup always includes a dependency install/check step.

Invariant I2: FFmpeg is a core operational dependency for advanced media workflows.
