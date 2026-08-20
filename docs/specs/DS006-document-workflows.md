---
title: DS006-document-workflows
summary: Defines Markdown source editing, explicit SOPLang editing, CRDT collaboration, and safe media insertion workflows.
---

# DS006 Document Workflows

## Introduction

Explorer supports ordinary Markdown work and structured document work without forcing every Markdown file into the same editor model.

## Core Content

The default Edit action for a Markdown file must open the [TinyMDE](wiki.html#definition-tinymde)-backed Markdown source editor and use Explorer's ordinary file-save path. The Advanced edit action may enter the SOPLang-aware workflow when a user needs document metadata, structured nodes, commands, variables, or references.

Structured document operations must preserve their Markdown persistence contract. Collaborative SCRIPTA operations use the Explorer-owned [Automerge](wiki.html#definition-automerge) [CRDT](wiki.html#definition-crdt) state under the private Explorer workspace data root. The CRDT mutation path covers open, pull, mutate, merge, save, synchronization, and delete behavior; mutations are serialized per document and the resulting state is materialized back to Markdown. A caller must not bypass that path by writing structured document content directly.

The Markdown CRDT is the collaboration mechanism for structured Markdown and SCRIPTA documents, not a universal storage format. Ordinary source editing remains a regular single-resource save flow, while Office co-editing uses OnlyOffice's collaboration transport and signed callback persistence. Public SCRIPTA replicas must expose only the sanitized collaboration model and must not leak author-only or reaction-private metadata.

Media attached through workspace workflows must preserve the validation and storage rules of the owning media service. Document insertion must reference an approved stored media item through the established server-side document mutation path.

## Conclusion

Explorer provides simple Markdown editing by default and explicit structured collaboration when the document requires it.
