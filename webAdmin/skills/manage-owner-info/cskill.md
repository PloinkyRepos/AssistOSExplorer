# manage-owner-info

## Description
Creates, updates, or reads `data/config/owner.md` for owner contact and meeting configuration data. It is useful when an owner wants to maintain the contact details that support lead handoff and meeting proposals.

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
