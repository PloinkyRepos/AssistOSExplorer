# DS010 - Skill: manage-owner-info

## Goal
Create or update `data/config/owner.md` with owner contact information.

## Mechanism
A **cskill** executed through `MainAgent` when the owner updates contact details.

## Tool Definition
- **Name**: `manage-owner-info`
- **Description**: Writes freeform owner contact info and supports targeted updates.
- **Inputs**:
  - `content` (string, optional): full replacement content.
  - `email` (string, optional)
  - `phone` (string, optional)
  - `calendar` (string, optional)
  - `meeting` (string, optional)
  - `read` (boolean, optional): when true, returns current content.

## Output
Plain-text string only:
- read mode: current owner content as readable text
- update/replace modes: readable status text (+ updated fields when relevant)
- validation/runtime failures: deterministic error text

## Execution Logic (Node.js)
1. If `read` is true, return the current file content (empty if missing).
2. If `content` is provided, overwrite `owner.md` with the supplied text.
3. Otherwise, update or append lines with standard prefixes:
   - `Email:`, `Phone:`, `Calendar:`, `Meeting:`
4. Preserve any non-matching lines.
