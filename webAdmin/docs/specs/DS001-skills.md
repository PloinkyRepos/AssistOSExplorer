# DS001 - webAdmin Skills and Reporting Logic

The **webAdmin** agent interacts with the information collected by **webAssist**.

Runtime dependency note:
- `webAdmin` uses AchillesAgentLib via direct package import from `node_modules`.
- The agent runtime composes a `MainAgent` instance imported from `achillesAgentLib`.

Skill runtime note:
- Operational webAdmin skills are implemented as **cskills** (`cskill.md` + `src/index.mjs`).
- They are discovered and registered from `webAdmin/skills/` by `MainAgent`.
- Execution is routed through `MainAgent` skill execution APIs.
- File persistence is handled through `MarkdownDataStore` (AchillesAgentLib) with numbered markdown sections (`### N. Section Name`).
- Skill outputs are plain-text only (success and failure paths) and do not use JSON envelopes.
- Skills do not rely on `success` flags; status is communicated through deterministic text lines.
- Owner requests are orchestrated by the `admin-flow` system prompt.
  - The system prompt returns a plain-text response string for the owner in structured, user-friendly formatting.

## Skill: update-lead
- **Function**: Manages the lifecycle of a lead in `leads/`.
- **States**: Transitions a lead from `new` to `invalid`, `contacted`, or `converted`.

## Skill: lead-info
- **Function**: Displays comprehensive profiling and interaction data for a selected lead.

## Skill: statistics
- **Function**: Aggregates interaction metrics.
- **Reporting Intervals**: Day, week, month, year.
- **Metrics**: Total number of sessions, total leads generated, and leads by specific profile.

## Skill: news
- **Function**: Summarizes recent lead activity.
- **Output**: Recent entries in `leads/` with a brief overview of their status and profile.

## Skill: manage-profile
- **Function**: Lists profiles, displays one profile, or creates/updates a profiling template in `profilesInfo/` for the webAssist agent to use when matching visitors.

## Skill: manage-site-info
- **Function**: Creates or updates one/many site information files under `data/info/`, and can display a specific file.

## Skill: manage-owner-info
- **Function**: Creates or updates `data/config/owner.md` with owner contact information.

## System Prompt: admin-flow
- **Function**: Orchestrates owner requests by selecting and executing exactly one admin skill per turn.
- **Context Preload**: Receives preloaded profiles list, owner info, and website info at every iteration.
