# DS04 - FFmpeg Media Processing

## Role of This Document

This document describes the `ffmpegImageToVideo` skill contract and FFmpeg-based media processing rules.

## Skill Scope

`ffmpegImageToVideo` produces MP4 output from a list of images and optional audio track input. The result is uploaded to blob storage and returned with useful metadata (`id`, `downloadUrl`, `mime`, `size`).

## Input Requirements

Requirement M1: input must contain at least one image.

Requirement M2: sources may be blob IDs or HTTP(S) URLs.

Requirement M3: rendering parameters (`duration`, `fps`, `width`, `height`, `bg`) are optional, with operational defaults.

Requirement M4: SVG image inputs are explicitly rejected.

## Processing Guarantees

Guarantee G1: blob-ID downloads, relative blob download paths, and output
uploads use only the launcher-injected `PLOINKY_ROUTER_URL`. The skill fails
before media work when that value is absent or is not an HTTP(S) origin; it
does not fall back to loopback, host gateways, alternate router variables, or
caller-provided blob bases.

Guarantee G1.1: explicit external HTTP(S) image, audio, and blob-store response
URLs are fetched or returned unchanged. The skill does not silently rewrite
`localhost`, `127.0.0.1`, or any other external hostname.

Guarantee G2: it runs FFmpeg using a `scale + pad + libx264 + yuv420p` pipeline for compatible MP4 output.

Guarantee G3: temporary files are cleaned up at the end, including error paths.

Guarantee G4: output is uploaded to blob storage before return.

## Constraints

Constraint F1: without FFmpeg available in runtime, the skill cannot complete.

Constraint F2: input download and output upload failures propagate to the caller as execution-level errors.

Constraint F3: Ploinky must inject `PLOINKY_ROUTER_URL` for every invocation,
including invocations whose inputs are all external URLs, because the rendered
output is always uploaded through the router blob API.
