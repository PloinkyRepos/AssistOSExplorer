# Chapter 2: Achilles IDE as AssistOS Explorer

Every modern operating system needs two fundamental components: a window management system and a file explorer. AssistOS is no different. The Achilles IDE serves as the AssistOS Explorer, providing the central interface through which users navigate, manage, and interact with their AI-powered work environment.

## From Research to Product

The development of Achilles IDE was significantly accelerated by winning EU funding for the Achilles research project. This project built upon earlier research results and prototyping work within AssistOS, transforming conceptual designs into a production-ready development environment.

The Achilles IDE is more than a traditional code editor. It is a workspace designed from the ground up for AI-assisted development and content creation. It integrates file management, version control, agent configuration, and pipeline orchestration into a single cohesive interface.

## Integrated Document Management

Achilles IDE includes a confidential document management system integrated directly into the Explorer interface, managed by the DPU Agent.

`/Confidential/My Space` is the private area where users create personal folder structures and files.

`/Confidential/Shared` is the collaboration zone where files shared by others appear with appropriate access permissions.

`/Confidential/Secrets` is a virtual file list where each file represents a secret. Readable secrets show their content. Writable secrets can be updated, and changes propagate instantly to all entities with access rights. Users can also view which entities have permissions on each secret.

## OnlyOffice Integration

Files with `.docx`, `.pptx`, and `.xlsx` extensions open directly in the browser through an integrated OnlyOffice Document Server instance. Edits are saved back to the confidential file system, respecting the access rules established by the Secrets Agent. This provides a familiar collaborative editing experience within the secure workspace boundary.

## GitHub and Repository Control

Like any modern IDE, Achilles IDE provides full Git repository control, including commit, push, pull, and branch management. AssistOS extends this model by allowing agents to manage repositories autonomously. A researcher can ask an agent to commit changes, create branches, or manage entire repositories, turning routine version control tasks into conversational commands.

## WebMeet and Interactive Copilot

AssistOS includes WebMeet, a sovereign replacement for Slack or Discord, optimized for human-AI interaction.

WebMeet supports audio-video and chat through WebRTC peer-to-peer connections organized by workspace groups and channels, with persistent history and transcription.

AI agents can be added to calls or chats. They operate passively by default, observing, indexing context, and recording for long-term memory, or actively when directly addressed.

Recordings can be sent to AI pipelines for meeting minutes generation or automatic task extraction.

Achilles Copilot provides an interactive conversational medium where users talk with agents, and agents can control shared visual surfaces through the agent-blackboard system.

## Agent-Blackboard: Visual Collaboration

The agent-blackboard is a shared visual surface controlled by AI agents instead of screen sharing. Agents can display text, shapes, cards, images, SVG diagrams, browser captures, YouTube clips, tables, lists, timers, inputs, and simple animations.

The blackboard supports both a common board visible to all participants and individual boards for private interactions. This enables agents to present results, guide discussions, run interactive quizzes, and orchestrate collaborative sessions through a controlled visual interface.

## AxiFace: Agent Visual Presence

AxiFace is a lightweight JavaScript library for displaying expressive SVG-based agent faces in chat interfaces, video conferences, or any AI product. It provides a visual presence — robotic, schematic, or abstract — that reacts to conversation state with emotions, thoughts, and micro-animations.

Each instance is isolated, controllable through HTML attributes or a JavaScript API, and can respond to global events. This gives agents a visual identity without the complexity of 3D avatars.

## AudioAgent: Voice Integration

Ploinky AudioAgent connects audio conversations in WebMeet with agent instances. When voice is active, AudioAgent transcribes what is said and delivers transcriptions to agents as internal messages.

When an agent wants to respond vocally, AudioAgent generates the audio file, temporarily locks microphones to prevent echo, and instructs the WebMeet UI to play the agent's voice. This creates a seamless audio conversation loop between humans and agents.

## The Explorer Paradigm

Just as Windows Explorer or macOS Finder became the central hub for managing digital files, Achilles IDE aims to become the central hub for managing AI-augmented work. It is the place where specifications are written, pipelines are configured, agents are orchestrated, documents are collaboratively edited, and results are reviewed, all within a secure, agent-aware environment.

The IDE is available as a standalone application and can be initialized through the Ploinky environment with a single command, making it accessible to both technical and non-technical users.

Explore Achilles IDE → Chapter 3: Installation and Architecture
