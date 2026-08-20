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

External access, transfer, protected execution, or publication must require a DPU action proposal and confirmation by its intended authenticated actor. Explorer must represent pending, blocked, and failed outcomes without bypassing provider conditions. Secure and federated execution controls must remain unavailable unless DPU reports an active backend capability.

## Conclusion

Confidential and research-data features remain integrated in Explorer while sensitive authority and irreversible effects stay in dpuAgent.
