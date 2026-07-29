# Explorer QA Administration Surface Missing

## Status

The initial route-surface fix was deployed on `ploinky-proxy` on 2026-07-29,
but the clean QA acceptance rerun proved that the public Administration
contract remains incomplete. The tab and existing users now load, while the
page reports `auth_route_context_mismatch` and public user mutations still
cannot satisfy their local-only control-origin proof. The second Ploinky
correction is published as
`e578b28cb965b3bd52063b4e450c627d6af971a6`; clean redeployment and acceptance
remain required.

## Environment

| Field | Value |
| --- | --- |
| Origin | `https://explorer-qa.axiologic.dev` |
| Deployment | GitHub Actions run `30484668139`, Explorer `1348b0d`, Ploinky `00f0adf` |
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

## Clean Deployment Follow-up

The clean deployment reached 16/16 running agents and a stable managed
Cloudflare connector before the suite started. The Administration tab is now
visible, and the accessibility snapshot contains the `admin` and `user` rows,
proving the selected-root user-list route works.

The page nevertheless fails its load contract with:

```text
Browser mutation proof failed: auth_route_context_mismatch
```

`admin-settings-panel` loads the DPU audit configuration through
`/dpuAgent/mcp`. `MCPBrowserClient` therefore requests
`/auth/token?agent=dpuAgent`. On the selected-root public origin the
authenticated browser is host-bound to `explorer`, so the Router correctly
rejects that selector switch. The client treats the rejection as a terminal
page-load error even though the Explorer user list has loaded.

There is a second independent blocker behind that error. User creation,
updates, and deletion call the selected-root `/api/agents/explorer/users`
surface, but `handleUserAdminRoutes` protects those mutations with the
Router's local control-origin CSRF guard. That guard accepts only a
non-forwarded localhost control origin, while `/auth/token` deliberately omits
`adminControl` on the public Cloudflare host. Consequently a public
Administration mutation cannot produce a proof that its handler will accept.

The headless run started at `2026-07-29T19:47:24Z` and ended with one unexpected
failure and one skipped serial test. No user or document content was created.

## Follow-up Correction Boundary

The host-bound MCP proof flow must support an allowed service route without
letting a query-string selector override the selected root. The server-minted
proof remains authoritative for the session, exact public origin, immutable
generation, and host-bound root; the browser must not invent or weaken those
bindings.

Selected-root Administration mutations need a public-origin proof designed for
the named `user-admin` surface. It must remain session-bound, generation-bound,
same-origin, restricted to the selected root agent, and require the existing
server-side administrator role check. The local Dashboard/control proof must
remain local-only, and unrelated Router administration must stay unreachable.

Regression coverage must exercise the full public-host flow: load the
Administration page including DPU audit configuration, create a run-scoped
user, update it, and delete it. It must also prove that another agent selector,
cross-origin requests, non-admin sessions, stale generations, and unrelated
control paths remain denied.

## Follow-up Correction

Service MCP browser proofs now keep the public authentication selector pinned
to the host-bound Explorer root while naming an independent `mutationRoute`.
The Router admits that route only when it belongs to the active root's compiled
MCP closure, and the proof MAC binds both the Explorer root and the admitted
service target. This permits the DPU audit call without allowing query-string
agent switching or arbitrary service selection.

Public selected-root user Administration now uses a separate cryptographic
proof purpose and a dedicated HttpOnly, path-scoped cookie. The proof is minted
only after an authenticated administrator loads the named public `user-admin`
surface. It is bound to the exact public origin, session, immutable generation,
and selected root. A general root browser proof cannot substitute for it, and
the local Dashboard/control proof remains local-only.

Focused security and regression coverage passes 54/54 checks, including public
CRUD success plus denial of unrelated dependency proofs, selector switches,
wrong origins, stale generations, ordinary users, and unrelated Router paths.
The broad Node unit suite passes 1,828 tests with 2 intentional skips and no
failures.
