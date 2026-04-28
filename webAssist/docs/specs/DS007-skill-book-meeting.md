# DS007 - Skill: book-meeting

## Goal
To facilitate the transition from an automated chat session to a real human interaction by offering a meeting link or direct contact details.

## Mechanism
This skill is implemented as a **cskill** and called by the visitor-flow `systemPrompt` policy for highly qualified visitors requesting human contact.

## Tool Definition
- **Name**: `book-meeting`
- **Description**: Retrieves the site owner's calendar link or contact details to offer a direct meeting to a highly qualified lead.
- **Inputs**:
  - `sessionId` (string): The ID of the current session.

## Orchestrator Input Sources
- `sessionId`: from turn input.
- No additional user-derived parameters are required for this skill.

## Output
The tool returns a string containing the content of the config files in `data/config/` (such as `owner.md`), which includes the necessary links or emails.

## Preconditions
- A lead file for the current `sessionId` must already exist at `data/leads/{sessionId}-lead.md`.
- If no lead exists, the skill fails with the exact message:
  - `the current session user does not have a lead! check if user is qualified for a lead then create it`

## Execution Logic (Node.js)
1. Read the `data/config/` directory.
2. Concatenate the contents of the files found in that directory (e.g., `owner.md`).
3. Return the content so the LLM can use it to formulate a natural response offering the calendar link to the user.

## Invocation Rule
- The visitor-flow `systemPrompt` calls this skill only when the visitor explicitly asks to talk/meet/book with a human and lead existence is confirmed from `currentLead.exists`.
