---
title: DS005-confidential-and-research-data
summary: Defines the DPU-backed Confidential, Secrets, Research Data, Jobs, authorization, and provenance boundary in Explorer.
---

# DS005 Confidential and Research Data

## Introduction

Explorer projects protected DPU resources into the workspace while dpuAgent remains the authority for storage, authorization, audit, provenance, and external data operations.

## Core Content

Explorer must expose DPU virtual roots below `/Confidential`, including My Space, Shared, Secrets, Research Data, Jobs, and Audit when the DPU authorizes audit visibility. These paths are not ordinary filesystem paths and must be resolved through DPU tools.

Secrets must use dedicated DPU secret operations and must not be treated as normal text files or sent to OnlyOffice. Explorer must not expose credential values in a source configuration, resource preview, job view, log, or error. DPU source configurations must retain only a secret reference.

Research Data records must preserve provider identity, exact revision, access state, intended use, permissions, provenance, and derived job outcomes. Explorer may display an effective state and contextual actions, but DPU alone must evaluate ACLs and perform registration, access resolution, acquisition, sharing, cancellation, and provenance retrieval.

Explorer must present authorized resource provenance inline in a collapsed, expandable section of the resource preview. Expanding provenance must not replace the resource preview or require a separate navigation action.

Writable research-resource previews must expose one **Manage access** action for reviewing, granting, updating, and revoking resource ACL entries. Explorer must not present a duplicate sharing control for the same permissions modal.

The resource-preview WebChat action must be labeled **Ask about this resource** and launch dpuAgent with only the selected DPU resource identifier as contextual selection. It must not place resource metadata, file content, ACL data, secrets, or physical storage paths in the launch URL. dpuAgent must treat the identifier as an untrusted hint and resolve it through actor-authorized DPU tools before using it.

Explorer must retain the selected research resource and job identifiers in its bounded preview state until selection or directory context changes. Acquisition and access-request controls must enter a disabled busy state immediately, report that the DPU operation started, and refresh the authorized resource view after the tool or confirmation flow completes. A missing selection must produce a visible bounded error rather than a silent no-op.

An acquired local resource must be consumable only through DPU file-list, file-stat, and bounded file-read operations. DPU must verify the invocation scope and resource ACL on every call, accept only paths present in the verified manifest, reject traversal and symbolic links, and omit the physical materialization path from every response.

Explorer must expose a **Verify read** action for each file shown in an acquired resource's Verified Files section. The action must invoke a bounded DPU file read using the selected resource and manifest-relative file path, show an immediate busy state, and report the byte count, continuation offset or end-of-file state without exposing the returned file content or private materialization path.

Federated execution controls may be displayed only when DPU reports an enabled and identity-verified NVFlare backend. A proposal must resolve at least three participant resources approved for local-only federation, require secure aggregation and the DPU privacy assessment, and create a protected derived output when the external job succeeds. Secure execution controls must remain hidden until a concrete backend passes its connection, identity, attestation, and policy checks.

External access, transfer, protected execution, or publication must require a DPU action proposal and confirmation by its intended authenticated actor. Explorer must represent pending, blocked, and failed outcomes without bypassing provider conditions. Secure and federated execution controls must remain unavailable unless DPU reports an active backend capability.

## Conclusion

Confidential and research-data features remain integrated in Explorer while sensitive authority and irreversible effects stay in dpuAgent.
