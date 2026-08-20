# DS09 — Research Data, Secure Processing and Federated Learning

## Status

P1 is implemented as a clean-break storage and API contract. The release accepts only `dpu-research-v1` state and `dpu-permissions-v2`; an existing legacy root is rejected and is never imported, converted, or read through a fallback. P2 broker contracts exist but no secure or federated backend is advertised until one is configured and verified.

## Unified model

The private DPU root owns `users`, `secrets`, `confidentialObjects`, `resources`, `sources`, `jobs`, `actionProposals`, `provenanceIndex`, and `settings`. Research data is represented by records, not folders. Materialized files live under `materializations/<resource-id>/<revision>` and are projected through `/Confidential/Research Data`.

Resources carry provider identity, exact revision, persistent identifier, licence, citation, FAIR evidence, access conditions, intended use, owner/ACL/expiry, checksums, file manifest, restrictions, jobs and derived results. `executionMode`, `accessState`, and `visibility` are independent; `effectiveState` is the UI projection.

## Authority and confirmation

Invocation authentication is the only actor source. Source records contain `secretRef`, never credentials. dpuAgent authorizes secrets, confidential objects, resources and protected results. External effects require an immutable, expiring `DpuActionProposal` bound to its intended actor.

## Jobs and provenance

Jobs cover discovery, access, acquisition, transfer, remote execution, secure execution and federation. Provider work runs outside the storage lock. Local acquisition uses private per-job staging, streaming downloads, provider SHA-256 verification when available, cancellation checks and atomic publication. Interrupted local workers are closed and their own staging is removed; EDC operations remain recoverable through bounded polling. Provenance is append-only and separate from audit, correlated by IDs.

## Adapters and surfaces

Adapters declare capabilities and implement connection test, discovery, description, access resolution, acquisition and citation. Hugging Face resolves refs to commit SHA and handles public/private/gated datasets without accepting terms automatically. EDC maps catalog and ODRL facts and separates negotiation from transfer; a transfer is never projected as local merely because the remote operation was accepted. MCP uses `dpu_resource_*`, `dpu_source_*`, `dpu_research_*`, `dpu_job_*`, and `dpu_action_*`, with invocation scopes and redacted audit records. Explorer projects Research Data and Jobs and provides administrator Data Sources settings.

The P1 Explorer surface is implemented with WebSkel runtime components and the Explorer design system. Resource and job views reuse shared cards, buttons, status badges and action groups; confirmation and permission changes reuse the standard modal components. Data Sources separates Hugging Face and EDC with the shared settings tabs, filters each provider into its own panel, and opens a provider-specific inline form only for add or edit. Its dialog keeps a stable viewport-relative size while tab content scrolls internally and uses Explorer's standard fullscreen icon and `is-fullscreen` convention. Secret selection reuses `custom-select`; source type is fixed by the active provider panel and is never accepted from a user-editable control. Component-local CSS is limited to DPU-specific structure and responsive layout. The standard Explorer Tools menu exposes the initial `DPU Research` WebChat launcher even when Research Data is empty. The WebChat manifest enables the router envelope, and the CLI verifies the router request token against the exact `__webchat_message__` envelope before deriving the actor. The raw token is never placed in the LLM context. The conversational planner exposes the exact P1 research tools declared by `mcp-config.json`; their handlers and normal MCP dispatch share one authorization, validation, audit and domain execution path. Model input cannot provide an actor identity. The CLI preserves workspace directory, presentation visibility and explicit workspace references as agent context. WebChat mode consumes each newline-delimited envelope as it arrives on the long-lived runtime pipe; it must not wait for end-of-file between turns. The internal `/tasks` discovery command is handled locally with an empty WebChat task list because DPU Research does not expose Achilles background tasks. No slash command is forwarded to the research LLM. A failed visible request receives a bounded safe error and does not terminate the loop or block later requests; failures for invisible control messages remain silent. End-of-file input remains limited to one-shot CLI and MCP execution. The source forms expose only adapter fields supported by the implemented contracts: Hugging Face endpoint and secret reference, or EDC endpoint, counter-party address, provider ID, participant ID and secret reference.

DPU planner tool arguments use a strict nested contract: the planner decision is Markdown, while its `prompt` section contains exactly one fenced `json` block whose content is one JSON object. No raw JSON, prose around the block, untyped fence, array or malformed JSON is dispatched. The decoded object still passes the normal tool input validation and invocation authorization. A research planner may supply `sourceIds` only as exact DPU source UUIDs obtained from a prior DPU result; provider types, display names and guessed identifiers are rejected.

Planner input rejection is recoverable without weakening validation. A rejected Markdown or argument payload is returned to the planning loop as a structured `recoverable` result, so the next decision receives the validation reason and bounded retry instructions. For invalid `sourceIds`, the retry omits the rejected field and searches only sources that are enabled and authorized by DPU. The rejected provider label is never interpreted as a source identifier, and no provider operation runs for the rejected call.

## P2 contracts

The P2 secure broker contract accepts decisions only from injected confirmation, attestation and provider-policy verifiers; caller booleans are not authority. The P2 federation broker similarly requires an actor-bound confirmation and resolves every participant resource through a trusted local-only resolver. These contracts are not exposed as active P1 execution capabilities. Privacy assessment exposes VeriProv and FL-LR hooks instead of reimplementing those assets.

## Deployment

Stop dpuAgent, resolve the exact environment storage, archive or remove it by explicit operator decision, and start with an empty root. Recreate source configurations and secret references, then run health and end-to-end tests. No code automatically deletes or migrates storage.
