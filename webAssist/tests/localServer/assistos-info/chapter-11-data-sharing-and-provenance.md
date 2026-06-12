# Chapter 11: Data Sharing and Provenance

LightDSU is the encrypted data substrate of the Ploinky ecosystem. It provides local storage, versioning, auditing, and controlled access for encrypted data units. Together with DPU Agent, European Data Spaces integration, and the Data Sharing Plugin, it forms an architecture for sensitive data management, provenance tracking, and controlled sharing across organizations.

## Vision

Modern data collaboration must support two requirements that often conflict. Data needs to be discoverable and usable across organizations, but sensitive data must remain under the control of its owner. Ploinky addresses this by separating metadata discovery, controlled access, encrypted storage, sandboxed computation, and peer-to-peer transfer.

The result is a data sovereignty stack. Data can be described, discovered, requested, analyzed, and trusted without exposing raw data by default.

## Encrypted Data Units: LightDSU

LightDSU stores data as encrypted bricks. These are content-addressed blocks that can only be reconstructed with the correct keys. A special brick called the BrickMap maintains the virtual file system structure, references to data bricks, and the symmetric keys needed for reconstruction. The system is anchored by a cryptographically signed, append-only event log.

Access is controlled through three types of keys derived hierarchically from a master secret.

| Key type | Capability |
|---|---|
| lkey | Full control: write, grant, revoke, read, and verify. |
| rkey | Read-only access: decrypt the BrickMap, read files, and verify the anchor. |
| lza | Zero-access verification: verify anchor existence and history without seeing content. |

This hierarchy supports a powerful sharing pattern. A party can prove that a dataset exists and has a certain history through `lza` without seeing the data. A collaborator can receive read access through `rkey` without receiving write privileges. The owner retains administrative control through `lkey`.

## Provenance Profiles

Every operation on a LightDSU data unit produces a signed event in the anchor. For detailed provenance, LightDSU supports multiple profiles mapped to different standards and domains.

| Profile | Use |
|---|---|
| LIGHTDSU_MINIMAL | Lightweight technical provenance: operation, resource, actor, time, inputs, and outputs. |
| W3C_PROV | General provenance interoperability using entities, activities, and agents. |
| FHIR_PROVENANCE / FHIR_AUDIT_EVENT | Healthcare and clinical data provenance using HL7 FHIR standards. |
| GXP_AUDIT_TRAIL | Pharmaceutical and regulated environments, supporting FDA 21 CFR Part 11 and EU GMP Annex 11 requirements. |
| GA4GH_DATA_USE | Genomic data usage terms through the GA4GH Data Use Ontology. |
| RO_CRATE | FAIR research objects and publishing using RO-Crate metadata. |
| AI_ML_EXPERIMENT | Machine learning experiment provenance: datasets, models, code, parameters, metrics, and results. |

Each profile is stored as an encrypted brick referenced by a compact anchor event. The anchor remains small and inspectable, while detailed provenance remains encrypted and domain-specific.

## DPU Agent: Protecting Sensitive Data

DPU Agent is the data protection component of a Ploinky workspace. It owns sensitive data locally and exposes it to other agents only through controlled interfaces. Research agents do not receive raw data. They receive references such as `packageRef`, `taskRef`, and `resultRef`.

| DPU capability | Role |
|---|---|
| Secret Vault | Stores API keys, passwords, tokens, and credentials encrypted at rest. Secrets are injected into tasks, not exposed to agents. |
| Confidential Object Store | Manages files and folders with granular permissions such as access, read, comment, and write. |
| LightDSU Package Store | Stores encrypted data packages with policies, grants, and provenance. |
| Sandbox Execution | Runs tasks over sensitive data in isolated environments and returns only permitted outputs. |
| Audit and Provenance | Logs every access, task, export, and policy change in a verifiable form. |

## European Data Spaces Integration

Ploinky integrates with European Data Spaces through two cooperating agents.

EDS Adapter Agent is the external-facing component. It searches DCAT and DCAT-AP catalogues, describes datasets, summarizes usage policies, initiates access requests, attaches grants, and prepares imports. It translates external data-space concepts into stable Ploinky primitives such as dataset descriptors, policy summaries, access grants, and transfer plans.

DPU Agent receives approved data and materializes it as encrypted LightDSU packages. It enforces policies, runs sandboxed computations, and records provenance for imports, transformations, and results.

The separation is deliberate. The adapter handles external interoperability. The DPU handles sensitive data locally. Research agents operate through DPU task tools and do not require direct access to external data spaces or raw sensitive data.

## Data Sharing Plugin

The Data Sharing Plugin provides a minimal user interface for researchers to publish FAIR metadata descriptions of datasets, search metadata published by others, and request access to relevant data. All operations are executed by a local Data Sharing Agent through MCP tools.

| Screen | Function |
|---|---|
| My Shared Data | Shows datasets the user wants to make visible through metadata. |
| Create FAIR Metadata | Provides a guided form for metadata: title, description, domain, keywords, data type, provenance, access conditions, and restrictions. |
| Search Data Network | Searches the local index built from metadata published by the user and discovered through other agents in the Ploinky network. |
| Requests and Bookmarks | Tracks saved datasets, sent requests, received requests, and status. |

Metadata is published to a dedicated GitHub repository without publishing raw data. Other researchers can discover the metadata, request access, and receive approved data through Ploinky Wormhole’s secure peer-to-peer channels.

## Vision

LightDSU, DPU Agent, EDS Adapter, and the Data Sharing Plugin form a complete data sovereignty stack. The stack provides encrypted storage with verifiable provenance, controlled access through sandboxed execution, interoperability with European Data Spaces, and a discovery layer that connects researchers through metadata rather than exposed data.

The result is a system where data can be shared, analyzed, and trusted without leaving the control of its owner.
