---
title: DS000-vision
summary: Defines OnlyOffice Runtime-v5 as the authenticated document editing boundary for workspace and Confidential files.
---

# DS000 Vision

## Introduction

[OnlyOffice](wiki.html#definition-onlyoffice) must let Explorer edit supported Office documents while separating authenticated control from public editor transport.

## Core Content

The agent must own session lifecycle, tokenized editor configuration, callback validation, restart recovery, and storage selection. It must route Confidential persistence through [DPU](wiki.html#definition-dpu) delegation and keep browser credentials out of public [DocumentServer](wiki.html#definition-documentserver) traffic.

## Conclusion

OnlyOffice is a [Router](wiki.html#definition-router)-mediated editing boundary with explicit storage and callback ownership.
