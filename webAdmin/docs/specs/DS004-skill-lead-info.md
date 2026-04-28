# DS004 - Skill: lead-info

## Goal
To display comprehensive profiling, contact information, and interaction history for a selected lead to the admin.

## Mechanism
A **cskill** executed through `MainAgent` when the owner requests details for a specific lead.

## Tool Definition
- **Name**: `lead-info`
- **Description**: Retrieves the full profile, contact info, status, and related session history for a specific lead.
- **Inputs**:
  - `leadId` (string): The ID of the lead.

## Output
Plain-text string only:
- success: readable report containing lead fields, contact info, summary, and related split session data:
  - `data/leads/{leadId}.md`
  - `data/sessions/{sessionId}-profile.md`
  - `data/sessions/{sessionId}-history.md`
- failure: deterministic error text on validation or lookup failure

## Execution Logic (Node.js)
1. Read `data/leads/{leadId}.md`. If not found, return an error.
2. Extract the `sessionId` from the lead file name or contents.
3. Read `data/sessions/{sessionId}-profile.md` and `data/sessions/{sessionId}-history.md` when available.
4. Return the combined data as readable text so the LLM can answer the admin's query completely.
