---
title: DS011-scripta-core
summary: Defines Explorer-owned SCRIPTA identity, Markdown metadata, Automerge state, variants, voting, ownership, undo, public collaboration, security, and lifecycle.
---

# DS011 SCRIPTA Core

## Introduction

SCRIPTA is Explorer's structured collaboration model for Markdown documents. Explorer is the sole document authority. During editing, the canonical Automerge document is the working state and Markdown is its durable, portable materialization. WebMeet, Advanced Editor, and other consumers use Explorer's semantic or collaboration APIs; they do not parse, overwrite, or independently reconcile SCRIPTA Markdown.

This specification defines the Explorer-owned core. WebMeet board placement, room attachment, guest interaction, RoboTeam event mapping, Meeting Notes, and realtime presentation are integration concerns defined by WebMeet DS009.

## Identity And Storage

Each document, chapter, paragraph, variant, and variant image has a stable identifier. The document id comes from AssistOS Markdown metadata and remains the identity after rename or move; a filesystem path is only the current location. When a Markdown document has no document id, Explorer generates one and persists it in Markdown during the same first initialization before returning a usable editor or SCRIPTA projection.

Explorer stores canonical binary state at `.data/explorer/automerge/documents/<document-id>.automerge`. SCRIPTA's path-free, sanitized browser replica is stored separately at `.data/explorer/automerge/scripta-collaboration/<document-id>.automerge`. No `.automerge` sidecar is created beside the Markdown file. The canonical state contains the complete private model; the collaboration replica contains only the fields admitted by the public collaboration contract.

## Canonical Markdown Format

Markdown remains readable without SCRIPTA. The active variant is the visible paragraph text. Stable identity and plugin state are JSON values in the existing `achilles-ide-document`, `achilles-ide-chapter`, and `achilles-ide-paragraph` HTML comments. SCRIPTA does not use a separate YAML `<!-- scripta: ... -->` block.

A normative excerpt has this shape; generated ids and timestamps are illustrative:

```markdown
<!-- {"achilles-ide-document":{"id":"document-1","title":"Project Plan"}} -->
<!-- {"achilles-ide-chapter":{"id":"chapter-1","title":"Scope","anchorId":"chapter-chapter-1"}} -->
<a id="chapter-chapter-1"></a>
## Scope

<!-- {"achilles-ide-paragraph":{"id":"paragraph-1","pluginState":{"scripta":{"activeVariantId":"variant-2","variants":[{"id":"variant-1","text":"First formulation.","images":[],"createdBy":"owner-hash-1","createdAt":"2026-08-27T09:00:00.000Z","updatedAt":"2026-08-27T09:00:00.000Z"},{"id":"variant-2","text":"The selected formulation is visible as ordinary Markdown.","images":[],"createdBy":"owner-hash-2","createdAt":"2026-08-27T09:01:00.000Z","updatedAt":"2026-08-27T09:01:00.000Z"}],"reactionsByVariant":{"variant-2":{"participant-hash":{"type":"like","userHash":"participant-hash","userLabel":"Participant","reactedAt":"2026-08-27T09:02:00.000Z"}}}}}}} -->

The selected formulation is visible as ordinary Markdown.
```

The canonical state is `achilles-ide-paragraph.pluginState.scripta`, represented in the parsed model as both `paragraph.pluginState.scripta` and `paragraph.metadata.pluginState.scripta`. It contains `activeVariantId`, ordered `variants`, and `reactionsByVariant`. Each variant contains its stable id, clean text, ordered images, owner hash, and creation/update timestamps. The serializer writes the winning variant, including its image Markdown, into the visible paragraph and retains inactive variants, reactions, ownership, and stable ids in the metadata comment. User text is stored as text, never pre-escaped HTML; browser rendering must assign it as text or pass it through the approved sanitizer and must never interpret metadata as executable markup.

## Variants, Ownership, And Voting

Every SCRIPTA paragraph has at least one variant. The participant who creates a variant owns it and is the only participant allowed to edit or delete its text and images. The final remaining variant cannot be deleted. Owner hashes are private authorization data and are never accepted from a browser as proof of identity.

An admitted participant has at most one reaction across all variants of one paragraph. Applying the same reaction to the same variant toggles it off. Applying a reaction to another variant first removes the participant's previous reaction. Supported reactions are `like` and `dislike`.

The active variant is selected deterministically by these rules, in order:

1. Higher score, where `score = likes - dislikes`.
2. More likes.
3. Fewer dislikes.
4. Earlier `createdAt`.
5. Earlier position in the ordered variant list.

After every variant or reaction mutation, Explorer recomputes `activeVariantId` and materializes the winning variant as the paragraph's visible Markdown text.

## Mutations And Collaboration

Canonical semantic mutations are variant add/edit/delete, vote/vote-withdraw, variant image insert/replace/delete/layout, chapter add/delete/rename/move, paragraph add/delete/move, and undo. AI reformulation is not a persistence mutation: an integration may generate proposed text, but it persists the result through variant add. Focus, selection, edit-start, edit-cancel, and transient draft presentation do not modify the document model.

The public browser replica accepts incremental text changes only for the selected variant edit. Explorer validates that the submitted Automerge changes alter no other public field before merging them into canonical state. Structural operations, voting, ownership-sensitive changes, and media changes always use semantic mutations. Pull is based on `knownHeads`; apply includes the `baseHeads` from which the browser changes were created. If the requested heads are unavailable, Explorer returns `resetRequired` with a replacement state. One request accepts at most 128 changes and 2 MiB of encoded change data.

Markdown proposals validate their document identity and base heads before merging. Each proposal uses an actor derived from its document, sorted base heads, trimmed Markdown, and authenticated participant. Distinct proposals from the same base must not reuse an actor sequence. Once a proposal is accepted, its persisted collaboration history identifies retries as no-ops, including retries after a clock change or service restart; they return the current merged document without regenerating timestamps or structural ids. A new proposal after an undo must use the new base snapshot.

## Undo

Undo history is private, document-scoped, and bounded to the five most recent accepted SCRIPTA model changes. Every accepted semantic mutation and accepted collaboration edit or Markdown collaboration merge that changes the model pushes the complete pre-change model and the digest of the resulting model. Presentation-only operations do not enter history.

Undo applies only to the newest history entry. Explorer compares the current model digest with that entry's recorded post-change digest. If they differ because another change was accepted after the target operation, undo fails with `scripta_undo_conflict`; it never overwrites the newer state. A successful undo removes that history entry, commits the restored canonical model, rematerializes Markdown, updates the safe projection, and causes browser replicas to pull the new heads or reset when their heads are no longer available.

## Public Projection And Security

The canonical Markdown and canonical Automerge state contain ownership and reaction records. They are private workspace data, not encrypted fields inside the Markdown file. The sanitized collaboration replica removes `variant.createdBy` and `reactionsByVariant`. Viewer projections may expose only derived values such as counts, the current viewer's reaction, `canEdit`, and `canDelete`.

Explorer validates workspace paths, stable document identity, operation schemas, participant identity supplied by the authenticated caller, ownership, and resource lifecycle. Guest-facing integrations receive path-free resource identifiers and projections. SCRIPTA text and metadata are data: HTML, event attributes, URLs, and scripts embedded in titles, paragraphs, variants, labels, or metadata must not execute in preview, Blackboard, or editor surfaces.

## Lifecycle And External Changes

Create and first open initialize canonical Automerge state and materialize stable metadata atomically. Rename and move preserve the document id and therefore reuse the same canonical state. Save serializes the current canonical state to Markdown. A changed workspace Markdown file is reparsed and imported through Explorer synchronization; direct file content never becomes a competing authority while a canonical state exists.

Physical deletion is transactional across Markdown, canonical Automerge state, and the sanitized collaboration replica. Prepare stages every owned artifact, commit removes the stage after the attaching integration has persisted its detach, and rollback restores it. Explorer serializes lifecycle operations with a document lock and recovers expired pending deletions conservatively.

Deletion stages live only under `.data/explorer/automerge/documents/pending-deletions/<transaction-id>`. Every phase, including recovery after an earlier successful initialization, revalidates the private directory chain, transaction metadata, staged files, and related private artifacts before accessing them. Symbolic links are rejected with `PLOINKY_AGENT_DATA_POLICY_VIOLATION`. Preparation preflights all artifact paths before moving originals; rollback preflights staged files and destinations before restoring anything. If preparation fails and restoration cannot complete safely, the remaining staged originals are retained rather than deleted.

## Conclusion

SCRIPTA remains portable because the visible winner and complete structured metadata are materialized in Markdown, while safe concurrent editing is governed by one Explorer-owned Automerge authority and one explicit semantic contract.
