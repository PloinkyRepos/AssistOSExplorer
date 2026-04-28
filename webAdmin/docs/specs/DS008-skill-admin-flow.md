# DS008 - System Prompt: admin-flow

## Goal
Orchestrate a single owner request by selecting and executing exactly one admin skill, then returning the final owner-facing response.

## Mechanism
A static system prompt passed into `MainAgent.executePrompt(...)` on every owner turn.

## Description
Executes one of the admin skills (`news`, `statistics`, `lead-info`, `update-lead`, `manage-profile`, `manage-site-info`, `manage-owner-info`) based on the owner request.

## Inputs
The runtime prompt includes:
- The owner message.
- The list of known lead IDs.
- Preloaded profile list, owner info snapshot, and website info snapshot.

## Output
- **Plain text** response string (no JSON). The response must be in the same language as the owner’s message.
- **Operational text** (tool selection, arguments, intermediate notes) must be written in **English**.
- Skill outputs from admin cskills are already plain text and must remain plain text.
- The orchestrator must preserve the exact values coming from skills; only formatting can change.
- Internal flags such as `success` must not be shown to the owner.

## Execution Logic (Node.js)
1. Parse the owner message and identify which admin skill should be executed.
2. Build the skill arguments (apply defaults when needed and validate required fields).
3. Execute the selected skill via `MainAgent` (inputs in English).
4. Read the skill output text and draft the final owner-facing response in a structured, user-friendly format.
5. If skill output indicates an error, report it clearly in owner language without altering error meaning.
6. Return only the response string.
