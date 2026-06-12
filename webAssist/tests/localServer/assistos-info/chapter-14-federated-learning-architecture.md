# Chapter 14: Federated Learning Architecture

The Ploinky Federated Learning architecture enables organizations to collaboratively train AI models without sharing raw data. Each participant keeps data local in encrypted DPU packages, runs training in sandboxed environments, and exports only approved model updates that are signed, verified, and auditable.

## The Problem Federated Learning Solves

Many organizations have valuable data that cannot be centralized. Healthcare providers hold patient records. Financial institutions hold transaction data. Research laboratories hold proprietary datasets. Better models often require learning from diverse data sources, but moving raw data into one shared location is legally, ethically, or commercially impossible.

Federated learning addresses this tension. A model can be trained across multiple data sources without moving the data. Ploinky adds three capabilities on top of standard federated learning: data sovereignty through encrypted local storage, policy enforcement at every step, and verifiable provenance for every training round.

## Architecture Overview

The architecture has five main components.

| Component | Responsibility |
|---|---|
| Federated Learning Coordinator Agent | Defines the federation, invites participants, starts rounds, collects approved updates, and aggregates the global model. It never sees raw data or local secrets. |
| DPU Agent | Runs at each participant. It holds encrypted data packages in LightDSU, verifies local policies, runs training in sandboxes, and decides what artifacts can leave the workspace. |
| Ploinky Wormhole | Provides peer-to-peer communication between independent workspaces. It transports federation plans, updates, and confirmations as signed, encrypted, verified content. |
| LightDSU | Provides local encrypted storage. Each package uses a BrickMap, content-addressed bricks, and a signed event anchor. |
| Federated Training Skill | Performs the actual training. DPU Agent runs declared, validated, policy-approved skills rather than embedding every training type in its core. |

## The Training Cycle

The federated training process follows a controlled sequence.

| Stage | Description |
|---|---|
| Configuration | The coordinator defines the federation plan: model type, training skill, number of rounds, aggregation method, participation conditions, provenance requirements, and security constraints. The plan is signed and distributed through Wormhole. |
| Local acceptance | Each DPU verifies compatible data, package permissions, export policy, installed skill availability, and sandbox capacity. Participation is accepted or refused locally. |
| Round execution | The coordinator sends the current model and round specification. DPU Agent runs the training skill in a sandbox over the local package, produces the update and metrics, records provenance, and requests local export approval. |
| Update transfer | Wormhole transfers approved updates to the coordinator or Secure Aggregation Agent. The transfer is signed, encrypted, chunked, and confirmed. |
| Aggregation | The coordinator aggregates accepted updates, produces a new model version, and records aggregation provenance in the ModelDSU. |
| Finalization | The final model undergoes validation, export checks, and potentially human or organizational approval before use outside the federation. |

## Security Model

The security boundaries are explicit.

| Boundary | Rule |
|---|---|
| Coordinator to DPU | The coordinator can request training, but the DPU verifies locally whether training is permitted. |
| DPU to Coordinator | The DPU exports only approved updates and permitted metrics. |
| Wormhole Server to Content | The server does not see final content. It only assists with rendezvous and signaling. |
| Skill to Data | The skill sees data only inside the sandbox and only according to package policy. |
| LightDSU to User or Agent | Keys and raw data are never exposed directly. Access goes through DPU Agent. |

## Secure Aggregation

For sensitive scenarios such as medical, genetic, or commercial data, secure aggregation ensures that the coordinator receives the aggregate rather than individual contributions. This is important because model updates can leak information about local data.

In Ploinky, secure aggregation can be implemented as a separate agent or as a special mode of the coordinator. The design keeps this capability modular so that different federations can choose the appropriate security level.

## Differential Privacy

Federated learning reduces data centralization, but it does not eliminate leakage through model updates or final models. The system supports policies requiring gradient clipping, noise addition, metric limits, minimum participant counts, and leakage checks.

For a first operational baseline, the minimum includes update clipping, format validation, prohibition of individual prediction exports, and complete round logging.

## Provenance

Every local round produces provenance inside the participant workspace. This includes local dataset hashes, input model, executed skill, sandbox environment, parameters, metrics, produced update, and export decision.

The coordinator produces aggregation provenance. This includes the updates included, aggregation method, participant dropouts, resulting global model, and applied verifications.

Recommended provenance profiles include AI_ML_EXPERIMENT, LIGHTDSU_MINIMAL, and W3C_PROV. These capture the relationships between entities such as datasets and models, activities such as training rounds and aggregation, and agents such as coordinators and participants.

## Vision

The federated learning architecture demonstrates the full power of the Ploinky stack. Data stays local in encrypted LightDSU packages. Training runs in sandboxed DPU environments. Communication flows through Wormhole peer-to-peer channels. Every step is signed, audited, and linked to a verifiable version.

The coordinator aggregates only what participants explicitly approve. Local policy decides participation and export. This is collaborative AI with data sovereignty built in, not added afterward.
