# manage-profile

## Description
Lists, displays, creates, or updates visitor profiling templates in `data/profilesInfo/`. It is useful for maintaining the profile catalog used by webAssist during visitor matching and qualification.

## Input Format
- `promptText` contains a JSON object with:
  - `profileName` (string, optional for list-all, required for display/create/update one profile)
  - `sections` (array of strings, optional for display mode filtering)
  - `characteristics` (array of strings, optional; when present, create/update mode)
  - `interests` (array of strings, optional; when present, create/update mode)
  - `qualifyingCriteria` (array of strings, optional; when present, create/update mode)

Mode mapping:
- `{}` => list all profiles
- `{ "profileName": "Developer" }` => display full profile
- `{ "profileName": "Developer", "sections": ["Interests"] }` => display selected sections
- `{ "profileName": "...", "characteristics": [...], "interests": [...], "qualifyingCriteria": [...] }` => create/update

## Output Format
- Plain-text string only.
- List mode (`{}`) returns a profile bullet list (or `No profiles found.`).
- Display mode returns a readable section list and rendered profile sections.
- Create/update mode returns readable status text with section bullets.
- Validation and lookup failures return plain-text error messages.

## Constraints
- Rejects invalid or unsafe profile names.
- Matches existing profiles case-insensitively and updates them in place.
- Persists profile content using numbered markdown sections (`### 1. Characteristics`, `### 2. Interests`, `### 3. Qualifying criteria`).
- Reads and renders profile sections using normalized section names.
- Does not call the LLM.
