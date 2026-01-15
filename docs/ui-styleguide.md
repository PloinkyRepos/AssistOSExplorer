# UI Style Guide (WebSkel Components)

## Scoping
- Prefer tag-based scoping: start selectors with the component tag (e.g., `task-item .task-item__name`).
- Avoid global class names like `.green` or `.failed-link`.

## Naming
- Use BEM-like naming inside components:
  - Block: `component-name__element`
  - Modifier: `component-name__element--state` or `component-name` host data-attributes.
- Prefer host `data-*` for state (e.g., `task-item[data-status="failed"]`).

## Smart vs dumb
- **Smart**: presenters (JS) that handle state and orchestration.
- **Dumb**: HTML/CSS only; no logic beyond data bindings.
- Smart components should update host `data-*` and let CSS handle visuals.

## Examples
- `task-item__status` with `task-item[data-status="completed"]`.
- `list-item__root` with `list-item[data-highlight="light"]`.
