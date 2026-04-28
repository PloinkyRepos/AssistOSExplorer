# DS007 - Skill: manage-profile

## Goal
Create or update a profiling template for the webAssist agent in `data/profilesInfo/`.

## Mechanism
A **cskill** executed through `MainAgent` when the owner requests a new profile.

## Tool Definition
- **Name**: `manage-profile`
- **Description**: Creates or updates a profile markdown file with characteristics, interests, and qualifying criteria.
- **Inputs**:
  - `profileName` (string): File name base or full `.md` name for the profile.
  - `characteristics` (array of strings)
  - `interests` (array of strings)
  - `qualifyingCriteria` (array of strings)

## Output
Plain-text string only:
- list mode: profile bullet list (or `No profiles found.`)
- display mode: readable section list + rendered profile sections
- create/update mode: readable status summary and section bullets
- validation/lookup failures: deterministic error text

## Execution Logic (Node.js)
1. Validate `profileName` and reject path separators or empty names.
2. Normalize the filename to include `.md`.
3. Find existing profiles by case-insensitive match on the filename.
4. Create `data/profilesInfo/` if missing.
5. Write the profile file using numbered markdown sections:
   - `### 1. Characteristics`
   - `### 2. Interests`
   - `### 3. Qualifying criteria`
