# MM04 - FFmpeg Media Processing

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

Guarantee G1: the skill normalizes URLs for containerized runtime (`host.docker.internal` fallback).

Guarantee G2: it runs FFmpeg using a `scale + pad + libx264 + yuv420p` pipeline for compatible MP4 output.

Guarantee G3: temporary files are cleaned up at the end, including error paths.

Guarantee G4: output is uploaded to blob storage before return.

## Constraints

Constraint F1: without FFmpeg available in runtime, the skill cannot complete.

Constraint F2: input download and output upload failures propagate to the caller as execution-level errors.
