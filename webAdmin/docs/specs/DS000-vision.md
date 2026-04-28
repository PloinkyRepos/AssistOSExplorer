# DS000 - webAdmin Vision

## Objective
The **webAdmin** agent is a backend management interface for site owners. It provides tools to analyze and process the data collected by the **webAssist** agent.

## Core Pillars
1. **Lead Lifecycle Management**: Transition leads from "new" to other statuses.
2. **Visitor Analysis**: Provide detailed profiling information for each lead.
3. **Usage Metrics**: Generate performance statistics (sessions vs. leads) over time.
4. **Real-time Awareness**: Display the latest leads obtained by the system.

## Runtime Integration
- **Entry Point**: `webAdmin/src/index.mjs`
- **Agent Factory**: `webAdmin/src/WebAdminAgent.mjs`
- **Agent Core**: A `MainAgent` instance is composed inside the factory (not subclassed).
- **Skill Runtime**: Operational skills are implemented as cskills and executed through `MainAgent`.
- **Orchestration**: Owner requests are routed through the `admin-flow` system prompt policy.
- **Discovery Scope**: `MainAgent` is initialized with `startDir = webAdmin/`, discovering skills from `webAdmin/skills/`.

## AchillesAgentLib Loading Contract
- `webAdmin` must import Achilles directly with:
  - `import { MainAgent } from "achillesAgentLib";`
- The runtime must not use custom filesystem loaders for Achilles resolution.
- Module resolution is delegated to Node.js package resolution via local `node_modules`.
