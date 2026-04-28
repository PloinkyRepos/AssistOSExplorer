# DS002 - Skill: update-lead

## Goal
To manage the state and lifecycle of a lead inside the `webAdmin` application.

## Mechanism
A **cskill** executed through `MainAgent` when the owner requests status updates for a lead.

## Tool Definition
- **Name**: `update-lead`
- **Description**: Updates the status of an existing lead in the system.
- **Inputs**:
  - `leadId` (string): The identifier of the lead (typically `{sessionId}-lead.md`).
  - `newStatus` (string): The new state for the lead. Allowed values: `invalid`, `contacted`, `converted`.

## Execution Logic (Node.js)
1. Ensure the `leadId` exists in `data/leads/`.
2. Read the markdown file corresponding to the lead.
3. Parse the markdown and replace the "Status:" line with the `newStatus` value.
4. Write the file back to disk in `data/leads/`.
5. Return a plain-text result on all paths:
   - success: readable status update summary and core lead fields;
   - failure: deterministic error text when lead file is missing or status is invalid.
