# manage-owner-info

## Description
Creates or updates `data/config/owner.md` with owner contact information. Typical triggers include read/show intents (`show owner info`, `display contact info`, `view owner details`), targeted field updates (`update email`, `change phone`, `set calendar`, `set meeting link`), and overwrite intents (`replace owner info`, `rewrite owner contact details`).

## Input Format
- `promptText` contains a JSON object with:
  - `content` (string, optional) – full replacement content
  - `email` (string, optional)
  - `phone` (string, optional)
  - `calendar` (string, optional)
  - `meeting` (string, optional)
  - `read` (boolean, optional) – when true, returns current content

## Output Format
- Plain-text string only.
- Read mode returns current owner content as readable text.
- Update/replace modes return readable status text and updated field details.
- Validation and runtime failures return plain-text error messages.

## Constraints
- Uses freeform text; updates only known prefix lines (Email:, Phone:, Calendar:, Meeting:).
- Does not call the LLM.
