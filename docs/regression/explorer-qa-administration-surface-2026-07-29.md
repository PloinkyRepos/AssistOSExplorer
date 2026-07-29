# Explorer QA Administration Surface Missing

## Status

Fix implemented on `ploinky-proxy` on 2026-07-29; QA redeployment and acceptance
rerun remain pending. Authentication, Explorer loading, and public MCP routing
already pass, but the currently deployed graph cannot create the two isolated
users until it is replaced.

## Environment

| Field | Value |
| --- | --- |
| Origin | `https://explorer-qa.axiologic.dev` |
| Deployment | Fresh `ploinky-proxy` graph after all 16 tracked agents reached running |
| Account | Authenticated bootstrap `admin` account |
| Browser | Headless Chromium via `npm run test:qa` |

## Expected

The authenticated QA administrator should be able to open Settings, select
Administration, create the two run-scoped users, and later remove them.

## Actual

Settings opens and loads the ordinary Agents, Plugins, Copilot, Keymap, Editor,
Theme, and Avatar tabs. The Administration tab is absent. The first acceptance
case fails in `openAdminUsers` before any user or content is created, and the
serial WebMeet case is skipped.

The client determines Administration visibility by probing:

```text
GET /api/agents/explorer/users
```

It exposes the tab only when that response is successful. The public edge
policy returns `ROUTE_SURFACE_DENIED` for this request. The failure is not a
selector timing issue: the tab is absent from the rendered accessibility tree
after 45 seconds.

The authenticated principal is correct: the bootstrap identity is
`local:admin` with both `user` and `admin` roles.

## Evidence

The current runtime evidence is stored under:

```text
tests/smoke/test-results/results.json
tests/smoke/test-results/80-explorer-qa-acceptance-*/error-context.md
```

The snapshot proves that Explorer and the Settings modal rendered normally
while Administration was not present.

## Investigation Boundary

The defect is a missing Ploinky public-host surface mapping, not an Explorer
role or credential problem. Add only the selected root agent's exact
user/settings endpoints to a closed administrator surface. Do not make all
Router administration public and do not bypass the UI with direct database or
container mutations.

Any public route correction must remain narrowly scoped, require a real
authenticated administrator session, retain origin/CSRF and server-side role
checks for mutations, and deny unrelated Router control surfaces. If the
security model intentionally forbids remote user administration, the product
must provide another explicit, user-visible way to create the two QA users;
the acceptance test must not silently seed the backing store.

## Correction

Ploinky now exposes a named `user-admin` surface for an agent-root public host.
The surface accepts only the selected root route key at these paths:

```text
/api/agents/<selectedRouteKey>/users
/api/agents/<selectedRouteKey>/users/<userId>
/api/agents/<selectedRouteKey>/settings
```

The Explorer QA deployment opts into that surface. Ploinky's existing handler
continues to require a valid local administrator session, and its mutation
paths continue to require exact Origin and session-bound CSRF validation.
Route-plan regression coverage proves that unrelated agents, malformed
lookalikes, and other Router administration/control paths remain denied.

After the fix, redeploy from `ploinky-proxy` and rerun both QA acceptance cases.
