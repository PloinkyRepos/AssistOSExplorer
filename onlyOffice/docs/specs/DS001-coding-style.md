---
title: DS001-coding-style
summary: Defines source layout, runtime safety, secret handling, and test conventions for OnlyOffice.
---

# DS001 Coding Style

## Introduction

This specification defines the implementation and verification rules for OnlyOffice [Runtime-v5](wiki.html#definition-runtime-v5).

## Core Content

The Node.js service must use ES modules, explicit asynchronous error handling, guarded path resolution, and atomic persistence for session state. Tests must remain under onlyOffice/tests/ and must cover route authentication, JWT claims, path policy, DPU delegation, and restart behavior.

Secrets must come from [Ploinky](wiki.html#definition-ploinky)-generated environment values and must not appear in logs, browser state, callback URLs, or documentation examples. [AchillesAgentLib](wiki.html#definition-achilles-agent-lib) use is authorized when supplied by the runtime; any [large language model](wiki.html#definition-llm) interaction must use the configured `LLMAgent` class with environment configuration and repository-level manual overrides. The OnlyOffice product contract defines no LLM feature.

## Conclusion

Guarded storage, short-lived credentials, and focused tests preserve the editor boundary.
