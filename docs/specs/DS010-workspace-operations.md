---
title: DS010-workspace-operations
summary: Defines Explorer navigation, ordinary file mutations, workspace search and replace, and protected-resource boundaries.
---

# DS010 Workspace Operations

## Introduction

Explorer provides one workspace surface for navigating, creating, changing, locating, and removing supported resources while preserving filesystem confinement and agent-owned authorization.

## Core Content

Explorer must browse configured workspace roots, restore supported file and directory routes, and select the registered preview or editor for the chosen resource. Ordinary paths must use Explorer's filesystem contract. Virtual paths under `/Confidential` must use DPU operations and must not be translated into ordinary filesystem mutations.

The New menu must create files and folders only when the current location permits them. Supported context actions must include rename, copy, cut, paste, upload, open in a new tab, open a terminal in a directory, and delete where the selected resource and owning provider allow that action. Delete must require confirmation. Successful mutations must invalidate affected caches, refresh the relevant directory, and clear selection or clipboard state that references a removed or moved path.

Find File must search workspace paths by name and support excluded glob patterns. Find/Replace in Files must support a base path, excluded patterns, case-sensitive matching, regular expressions, whole-word matching, selectable results, Replace Selected, and Replace All. Replace All must warn when results are truncated, large replacement sets must require confirmation, and the result must report changed files, missing matches, failures, or timeout state without claiming an unconfirmed success.

Every ordinary filesystem search and mutation must remain confined to configured allowed roots. DPU-backed actions must use effective resource capabilities for creation, rename, deletion, upload, child creation, and permissions. A disabled action must not be bypassed by sending the equivalent ordinary Explorer filesystem tool.

## Conclusion

Workspace operations are complete only when users can manage and locate supported resources while Explorer and each owning agent preserve their authorization and storage boundaries.
