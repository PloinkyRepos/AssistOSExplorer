# Chapter 6: Ploinky Wormhole

Ploinky Wormhole is a decentralized communication protocol designed for a world where AI agents are first-class participants. It replaces the client-server messaging paradigm with direct peer-to-peer connections, giving you the familiar experience of email and chat while keeping all data under your control: at the edge, in your workspace.

## Vision

Every website, workspace, organization, and agent needs a communication layer that does not assume permanent dependence on centralized platforms. Wormhole exists for this reason. It treats AI agents as first-class communicators and gives them a secure way to find one another, negotiate trust, exchange messages, transfer files, and coordinate workflows without placing the actual communication content on a central server.

The core architectural principle is simple. Servers help agents discover one another and establish a connection. Agents perform the actual communication. Trust, identity, policy enforcement, storage, and content handling remain at the edge, inside the user’s Ploinky workspace.

## The Problem with Today’s Communication

Every email you send, every message you write, and every file you share normally passes through servers you do not control. Your inbox lives on someone else’s infrastructure. Your contacts are stored in someone else’s database. Your communication metadata is visible to your provider, to intermediaries, and potentially to anyone who gains access to those servers.

This model worked when humans were the only communicators. In an agentic world, where software agents act on behalf of users, projects, and organizations, the limitations become operationally critical. Centralized routing adds latency and creates bottlenecks. A server outage can stop communication completely. Communication sovereignty is weak because messages and metadata are stored, indexed, and processed outside the user’s workspace. Existing protocols are also poorly aligned with agents that need to negotiate, transfer data, execute tasks, and enforce policies autonomously.

Wormhole addresses these problems by flipping the model. Agents connect directly to one another, while servers exist only to facilitate introduction and signaling.

## How Wormhole Works

Wormhole has two components, each with a clear responsibility.

| Component | Responsibility |
|---|---|
| Ploinky Wormhole Server | Provides rendezvous and signaling. It helps agents find one another and establish direct WebRTC connections. It does not store messages, read content, or decide trust. |
| Ploinky Wormhole Agent | Runs locally inside each workspace. It owns DIDs, manages contacts, enforces policies, negotiates with peer agents, and transfers content over peer-to-peer channels. |

The server makes the introduction. The agents do the actual work. Once the connection is established, the server is no longer part of the content path.

## Familiar Interfaces, Decentralized Infrastructure

Wormhole does not require users to change the conceptual form of communication. It provides familiar interfaces, but replaces the infrastructure underneath.

Wormhole Mail provides structured asynchronous communication similar to email. It supports subjects, recipients, CC and BCC, attachments, conversation threads, tags, and filters. The difference is architectural. There are no IMAP servers, no provider lock-in, and no externally controlled spam filters. Messages are signed and encrypted end-to-end. The mailbox is a local database owned by the workspace and can be backed up, migrated, or audited.

Wormhole Chat provides synchronous messaging similar to modern chat systems. Conversations happen directly between agents. Files transfer peer-to-peer. There is no cloud storage of messages, no central platform, no algorithmic feed, and no advertising layer.

The major behavioral difference appears when an unknown sender tries to communicate. In classical email, spam reaches the inbox and the user or provider must filter it afterward. In Wormhole, unknown senders appear as connection requests. The user or policy decides whether to accept, reject, or block. Unknown senders do not deliver content into the actual mailbox before acceptance.

## Identity You Control: DIDs

Every participant in Wormhole is identified by a Decentralized Identifier:

```text
did:wormhole:<server-domain>:<identifier>
```

A DID is not an email address and not a username on someone else’s platform. It is a cryptographic identity controlled by the local agent. The server can publish public keys and signaling information so others can find the identity, but private keys remain inside the agent.

DIDs support key rotation with cryptographic proof. When a key changes, the history remains verifiable. Contacts can see that a key changed and decide whether to re-confirm trust. In this model, identity is not guaranteed by a platform account. It is established and maintained through cryptographic continuity and local trust decisions.

A single workspace can host many DIDs. A user may have one DID for personal communication, another for a project, another for an organization, and additional DIDs for autonomous agents or functional inboxes. Each identity can have its own policies, contacts, mailbox, and trust relationships.

## Communication Between Organizations

Wormhole is designed for inter-organizational communication. It supports companies talking to companies, workspaces talking to workspaces, and agents talking to agents.

A research consortium can use Wormhole to coordinate without centralizing raw data. Each organization keeps its data inside its own workspace. Agents exchange documents, status updates, requests, results, and approvals through direct encrypted channels. No central platform needs to hold everyone’s sensitive material.

A supply chain can use Wormhole to exchange purchase orders, shipping notifications, quality reports, and verification documents. Manufacturers, suppliers, and logistics providers retain their own workspaces, policies, and data. Wormhole provides the communication layer that allows coordination without absorbing participants into one central platform.

This is organizational choreography: independent entities coordinate through a protocol that respects autonomy, enforces local policy, and keeps data local.

## Federated Learning and Sophisticated Protocols

One of the most important protocols enabled by Wormhole is federated learning. Organizations can collaboratively train AI models without centralizing data.

The architecture maps naturally onto Wormhole’s peer-to-peer infrastructure. A Coordinator Agent defines the federation, invites participants, and starts training rounds. It does not see raw data. A DPU Agent at each participant runs training locally in a sandbox over encrypted local data and decides what can leave the workspace. Wormhole transports the plan, model, approved updates, and confirmations between participants. LightDSU stores data, results, updates, and provenance locally, while keys remain under the control of the DPU.

Each training round can be audited. Each update is signed. Each participant controls its data and export policy. The coordinator aggregates only what participants explicitly approve.

Federated learning is one example. Wormhole can also support distributed data analysis, multi-party computation, coordinated automation, secure document exchange, and negotiated agent workflows. Wormhole is the transport. Agents define the higher-level protocol.

## Security by Design

Wormhole’s security model is explicit.

| Principle | Meaning |
|---|---|
| Servers are not trusted for content | Servers facilitate rendezvous and signaling. Message and file content are end-to-end encrypted and signed. |
| Agents decide trust | Acceptance, blocking, policy enforcement, and data handling happen locally inside the workspace. |
| Server visibility is minimal | A server may know that one DID wants to reach another DID, but it does not see the resulting content or negotiated task. |
| Key rotation is verifiable | Identity changes preserve cryptographic continuity and can trigger contact re-confirmation. |
| Policies are local | Each workspace defines who can connect, what can be shared, what requires approval, and what is blocked. |

## What Wormhole Is Not

Wormhole is not a cloud messaging platform. It does not store messages on someone else’s servers. It does not scan content for advertising. It does not decide who users may talk to. It does not force replacement of existing tools. It provides a protocol that tools and agents can use when decentralization, sovereignty, and agent autonomy matter.

Wormhole is infrastructure for a world where agents are first-class communicators, organizations retain sovereignty over their data, and trust is cryptographic rather than institutional.
