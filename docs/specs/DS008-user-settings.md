---
title: DS008-user-settings
summary: Defines user preferences, workspace integration controls, avatar configuration, and administrator-only settings surfaces.
---

# DS008 User Settings

## Introduction

Explorer exposes settings surfaces for preferences and enabled integrations without allowing browser state to become the source of authority.

## Core Content

The Settings modal must expose the confirmed Agents, Plugins, Copilot, Keymap, Editor, Theme, Avatar, and administrator-only Administration surfaces. Settings controls must use shared WebSkel and Explorer UI components and must present loading, error, empty, and disabled states consistently.

Agent settings must be discovered from enabled agent manifests and loaded only when available to the current account. Plugin settings must use the Explorer settings contract, persist workspace plugin state through Explorer tools, and honor the application plugin whitelist. Copilot skill toggles in the Settings modal are temporary browser state and must not be presented as persisted manifest configuration. The Copilot catalog must come directly from the public `list_achilles_skills` MCP tool owned by AchillesCLI; Explorer must not import AchillesCLI discovery modules or depend on its dependency layout.

Keymap settings must support the declared file search, content search, replace, save, autocomplete, and Settings actions, including clearing individual shortcuts and restoring defaults. Theme settings must apply the supported global light or dark theme. Editor settings must keep auto-save disabled by default, apply a configurable idle interval when enabled, and preserve the external-change conflict check before saving.

Avatar settings must require authenticated access and must use the configured AxiFace integration contract. The profile avatar is browser-owned preference state. Agent-avatar overrides must remain unavailable unless the authenticated user has management authority. Explorer must validate returned agent configuration before rendering it and must keep a failed external avatar integration from blocking normal workspace navigation.

Administrative settings must remain hidden from non-administrators. Administrative operations, including DPU data sources, must request data through the owning agent's authorized tools; the client must not reproduce administrative authorization rules or embed secrets in browser-visible configuration.

## Conclusion

Settings improve the workspace experience while configuration authority remains with the configured service or owning agent.
