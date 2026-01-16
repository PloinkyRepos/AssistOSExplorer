# Backlog Editor Plan (Clarified)

## Scope
Implement a full-featured backlog editor for `.backlog` files in the Ploinky container, using webskel UI components and AchillesSkills backend. The editor supports LLM model selection, plan generation, plan editing/regeneration, review/execution, and persists the accepted plan to `backlogPlan.md`.

## Core Requirements (unchanged + clarified)
1. Model selection dropdown at the top of the editor. The selected model is used for all LLM operations in this document.
2. Available LLM models are loaded dynamically from the agent configuration.
3. The editor allows writing and adding backlog items (bugs/features).
4. Analyze sends the entire backlog to the chosen LLM to generate an implementation plan.
5. The plan is displayed as a list of modular `plan-item` components; each item can be edited, accepted, or regenerated with feedback.
6. Review Plan and Execute Plan use the chosen LLM to validate or implement the entire accepted plan.
7. The accepted plan is saved to a repository file: `backlogPlan.md`.

## Data Contracts
### PlanItem schema (minimum)
```
{
  "id": "string",          // stable identifier for UI updates
  "description": "string", // editable text
  "status": "proposed" | "accepted" | "rejected",
  "filePath": "string"     // optional, used by execute when available
}
```

### Events emitted by `plan-item`
- `update-item`: `{ id, description }`
- `regenerate-item`: `{ id, feedback }`
- `accept-item`: `{ id, accepted: true }`

### LLM outputs
- `#analyze`: JSON array of PlanItem objects (with stable ids)
- `#regenerate_item`: JSON object for a single PlanItem (must preserve id)
- `#review_plan`: plain text summary + optional JSON `{ ok: boolean, notes: string[] }`
- `#execute_item`: updated file content for the target filePath

## Implementation Plan

### 1) Backend Skill: `backlog-skill`
- Location: `explorerSkillsAgent/.AchillesSkills/backlog-skill/`
- Create `cskill.md` with prompt sections:
  - `#analyze`: takes backlog content + context, returns JSON array of PlanItem.
  - `#regenerate_item`: takes a single PlanItem + feedback, returns updated PlanItem (same id).
  - `#review_plan`: takes plan JSON, returns validation summary (text or JSON).
  - `#execute_item`: takes a PlanItem + file content, returns modified file content.
- Create `backlog-skill.js` with exported functions (each accepts `modelName`):
  - `analyze(backlogContent, context, modelName)`
  - `regenerateItem(planItem, userFeedback, modelName)`
  - `reviewPlan(plan, modelName)`
  - `executePlan(plan, modelName)` iterates accepted items, reads files, calls `#execute_item`, and writes results.
- Update `explorerSkillsAgent/manifest.json` to register the new skill.

### 2) Backend Skill: Dynamic Model Loading
- Location: `explorerSkillsAgent/.AchillesSkills/` (new system-skill or add to existing).
- Function `getAvailableModels()` reads LLM config from `achillesAgentLib` and returns `string[]` of model names.
- Identify the exact config file path in `achillesAgentLib` (likely `.json` or `.mjs`).

### 3) Frontend Component: `plan-item`
- Location: `explorer/web-components/components/plan-item/`
- `plan-item.html`: template with view/edit modes; bindings with `@` syntax; buttons for Edit/Save/Cancel/Regenerate/Accept.
- `plan-item.js`:
  - Receives data via `item-data` prop.
  - Manages internal state (e.g., `isEditing`).
  - Emits only custom events (no service calls): `update-item`, `regenerate-item`, `accept-item`.

### 4) Frontend Component: `backlog-editor`
- Location: `explorer/web-components/components/backlog-editor/`
- `backlog-editor.html`:
  - Toolbar with model dropdown + buttons: Analyze, Review Plan, Execute Plan.
  - Textarea for backlog content.
  - Plan container rendering `<plan-item data-for="planItems" item-data="@"></plan-item>`.
- `backlog-editor.js`:
  - State: `backlogContent`, `planItems`, `availableModels`, `selectedModel`.
  - On init: fetch `availableModels` and populate dropdown.
  - Handlers: `selectModel`, `analyzeBacklog`, `reviewPlan`, `executePlan`.
  - Event listeners for plan-item events; orchestrate service calls using selected model.
  - After accept/review, persist plan to `backlogPlan.md`.

### 5) Frontend Service Layer
- Location: `explorer/web-components/components/backlog-editor/backlog-editor-service.js`
- Functions (all accept `modelName`):
  - `analyze(content, context, modelName)`
  - `regenerateItem(item, feedback, modelName)`
  - `getAvailableModels()`

### 6) Project Configuration
- Update `explorer/webskel.json`:
  - Register `backlog-editor` and `plan-item` components.
  - Add a file handler for `.backlog` -> `backlog-editor`.

## Persistence
- Save the accepted plan items to `backlogPlan.md` (markdown list) after Review or Accept actions.
- File location: repository root (same level as `README.md`).
