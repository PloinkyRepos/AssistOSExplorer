# backlog-skill

## Summary
Generate, refine, review, and execute backlog plans using the configured LLM.

## Prompts

### #analyze
Input: backlog content + context.
Output: JSON array of PlanItem objects.
Rules:
- Return ONLY JSON.
- Each item must include {id, description, status, filePath?}.
- status defaults to "proposed".

### #regenerate_item
Input: single PlanItem + user feedback.
Output: JSON object for the updated item.
Rules:
- Preserve the original id.
- Return ONLY JSON.

### #review_plan
Input: JSON plan array.
Output: short validation summary in plain text (no JSON required).

### #execute_item
Input: single PlanItem + file content.
Output: full updated file content (no JSON).
