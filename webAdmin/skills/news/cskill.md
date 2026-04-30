# news

## Description
Provides a consolidated activity snapshot from webAssist data. It is useful when an owner wants a quick overview of what changed recently across leads, profile details, and visitor conversation history, with independent limits per section.

## Input Format
- `promptText` contains a JSON object with:
  - `leads` (object, optional)
    - `limit` (number, optional; defaults to 5)
  - `profileDetails` (object, optional)
    - `limit` (number, optional; defaults to 5)
  - `sessionHistory` (object, optional)
    - `limit` (number, optional; defaults to 5)

At least one scope object is required.

## Output Format
- Plain-text string only.
- Success returns a readable evidence report (`Recent leads`, `Recent profile details`, `Recent session history messages`) with explicit counts (`showing X, requested limit Y`) and grouping by `Session: <sessionId>` where relevant.
- Validation and runtime errors return plain-text error messages.

## Orchestration Guidance
- Treat this skill output as evidence, not final owner phrasing.
- In owner-facing replies, summarize clearly instead of dumping raw lines.
- Prefer concise insights such as:
  - whether there are new leads (and short lead summaries),
  - how many active/recent conversations exist,
  - the main discussion themes extracted from profile details and session history.
- Preserve factual values from the skill output while making the response easy to read.

## Constraints
- All sections are sorted by most recent first.
- Top-level `limit` input is not supported.
- Does not call the LLM.
