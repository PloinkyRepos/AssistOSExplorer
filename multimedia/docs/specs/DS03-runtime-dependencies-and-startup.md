# DS03 - Runtime Dependencies and Startup Install

## Role of This Document

This document defines runtime requirements for starting the `multimedia` agent and its minimum dependency guarantees.

## Runtime Contract

The agent uses this manifest:

```json
{
  "lite-sandbox": true,
  "container": "node:24.15.0-bullseye",
  "profiles": {
    "default": {
      "install": "/code/scripts/install.sh"
    }
  }
}
```

## Startup Install Requirements

Requirement R1: the install script must run at startup to prepare the multimedia runtime.

Requirement R2: in container mode, the script must install `git` and `ffmpeg`.

Requirement R3: in host sandbox mode (`bwrap` on Linux, `seatbelt` on macOS), the script must validate that `git` and `ffmpeg` are present on the host.

Requirement R4: missing `git` in host sandbox mode is a blocking error; missing `ffmpeg` is an explicit warning.

## Constraints

Constraint C1: FFmpeg-dependent video processing features are not guaranteed when `ffmpeg` is missing from the runtime.

Constraint C2: in host sandbox mode, OS package installation is not managed by the agent; responsibility remains on the host.

## Invariants

Invariant I1: agent startup always includes a dependency install/check step.

Invariant I2: FFmpeg is a core operational dependency for advanced media workflows.
