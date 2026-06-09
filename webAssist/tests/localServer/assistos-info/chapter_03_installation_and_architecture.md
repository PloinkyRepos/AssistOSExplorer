# Chapter 3: Installation and Architecture

AssistOS is built on a layered architecture where each component serves a specific purpose while seamlessly connecting with the others. This chapter describes both how to install the system and how the pieces fit together.

## Getting Started

The AssistOS environment is built on top of Ploinky, the secure agent deployment platform. Once Ploinky is installed on the system, the entire AssistOS environment can be initialized with a single command:

```bash
ploinky start explorer
```

This command handles the complete initialization process: setting up the workspace directory structure, initializing the Achilles IDE as AssistOS Explorer, configuring default agent repositories, and establishing the local development environment.

## Prerequisites

Ploinky uses containerized environments for agent isolation, so a container runtime is required. Docker or Podman can be used for full container isolation. Alternatively, on Linux, bubblewrap provides lightweight sandboxing without full containers. On macOS, seatbelt, through `sandbox-exec`, offers similar lightweight isolation.

This simplicity is intentional. Researchers, designers, analysts, and professionals from any domain should be able to start working with AI agents without needing DevOps expertise.

## The AssistOS Architecture

AssistOS is organized around several interconnected layers, each addressing a critical aspect of AI-augmented work.

## The Workspace Layer

Achilles IDE, the AssistOS Explorer, is the central interface: a file explorer, code editor, and agent orchestrator. It integrates confidential document management with OnlyOffice for collaborative editing, GitHub repository control, the Achilles Copilot conversational interface, and the WebMeet audio-video conferencing system. It is the place where specifications are written, pipelines are configured, agents are orchestrated, and results are reviewed.

Ploinky provides the secure runtime: containerized agent isolation, sandboxed execution, and workspace management. It is the foundation that makes it safe to run untrusted agents and code.

## The Agent Layer

AchillesAgentLib implements the cognitive architecture patterns: the building blocks for creating intelligent agents that can reason, plan, and execute complex tasks.

Achilles CLI / Copilot is the main control agent: a conversational interface for commands, skills, Knowledge Units, and calls to other agents available in the workspace.

Predefined domain agents, specialized for research, data analysis, security, trustworthiness, and other domains, are available and can be extended with custom agents integrated into the Copilot interface.

The Backup Agent is a lightweight utility agent that handles automated workspace backups, ensuring that specifications, pipelines, and Knowledge Units are safely preserved and recoverable.

## The Reasoning Layer

AGISystem2 provides formal reasoning and knowledge management, ensuring that agent outputs are not only plausible, but logically sound and verifiable.

MRP-VM, the Meta-Rational Pragmatic Virtual Machine, is the execution model that turns natural-language-derived tasks into executable, controlled programs with interpreters, policies, traces, validation, and persistent state.

## The Communication Layer

Ploinky Wormhole is the decentralized communication protocol, replacing client-server messaging with direct peer-to-peer connections between agents. It enables modern email, chat, file transfer, and inter-organizational choreography without a central authority.

WebMeet provides audio-video conferencing with agent participation, blackboard control, and AudioAgent voice integration for seamless human-agent conversation.

## The Data Sovereignty Layer

LightDSU provides encrypted storage with verifiable provenance: data units stored as encrypted bricks with signed event anchors and support for multiple provenance profiles, including W3C PROV, FHIR, GxP, RO-Crate, and more.

The DPU Agent is the data protection component. It owns sensitive data locally, exposes it through controlled interfaces, runs sandboxed computations, and enforces access policies.

## The Verification Layer

The Trustworthy AI Agent inspects datasets, models, and runtime behavior to produce auditable findings, risk reports, and compliance mapping to frameworks such as the EU AI Act, NIST AI RMF, and ISO/IEC 42001.

The Security Guardian Agent monitors code, dependencies, containers, models, configurations, network activity, user behavior, and agent behavior across the entire workspace.

## The Knowledge Layer

AKU, Agentic Knowledge Units, organizes agent memory and knowledge through deterministic local indexing and BM25F search. This makes agent context transparent, auditable, and fast without relying on opaque vector embeddings.

## How the Layers Connect

The architecture is designed so that each layer can be understood independently, while the system’s power comes from integration.

The Workspace Layer is where users interact, write specifications, review results, and manage agents.

The Agent Layer executes user intent by running skills, calling other agents, and producing artifacts.

The Reasoning Layer ensures correctness by validating outputs and maintaining logical consistency.

The Communication Layer connects agents and humans through peer-to-peer, encrypted, decentralized communication.

The Data Sovereignty Layer protects data through encryption at rest, sandboxed execution, and audited access.

The Verification Layer builds trust through inspection, testing, reporting, and compliance mapping.

The Knowledge Layer accumulates learning so that every finding, experiment, and decision becomes a reusable unit.

Together, these layers form a complete environment for AI-augmented work, where every component is designed to work with the others, and where the whole is significantly more powerful than the sum of its parts.
