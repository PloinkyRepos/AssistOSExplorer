---
title: DS004-runtime-plugins
summary: Defines runtime plugin discovery, policy filtering, mounting, and domain ownership in Explorer.
---

# DS004 Runtime Plugins

## Introduction

Runtime plugins extend Explorer without transferring domain responsibility into the Explorer codebase.

## Core Content

Explorer must discover enabled plugin bundles from agent-owned or repository-local `IDE-plugins/*/config.json` locations through the IDE plugin collection flow. The host must validate a plugin manifest, resolve its declared component dependencies, and apply `applicationPlugins` policy before mounting an application plugin.

The `applicationPlugins` object in `explorer/manifest.json` is the host whitelist for application-plugin identities. A discovered application plugin must be enabled by that whitelist before workspace plugin settings can admit it. The `routerAccess` declaration publishes `/shared/*` and `/web-components/components/*` as public asset routes; it does not make protected agent tools or data public.

Reusable WebSkel libraries, shared components, and `shared/ui/ui-common.css` must be consumed from Explorer's `/shared/*` route. A plugin must not copy those assets into its own bundle or add a duplicate public route when the host-owned shared contract applies.

Plugins must use declared Explorer slots and the WebSkel presenter lifecycle. A plugin must not replace Explorer routing, navigation ownership, shared authorization, or host layout contracts. A plugin may render a domain control and call the owning agent's tools, but it must not duplicate that agent's ACL evaluation or persist its protected state.

An unavailable plugin component or dependent agent must produce a visible, recoverable interface error without preventing unrelated Explorer functionality from loading.

## Conclusion

The runtime plugin contract makes one workspace interface extensible while keeping each domain implementation independent.
