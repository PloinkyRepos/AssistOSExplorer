# OnlyOfficeAgent B2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the OnlyOfficeAgent decorator architecture with B2 router-minted user delegation so Office files outside `/Confidential` persist to a path-confined workspace filesystem and `/Confidential` Office files persist through dpuAgent as the acting user.

**Architecture:** The browser opens Office sessions through the Ploinky router at `/services/onlyoffice/office/session`. The router authenticates the user, mints a path-conditioned User Delegation Grant for dpuAgent only when the requested `path` is boundary-contained by `/Confidential`, and injects it into the verified HTTP-service auth-info. OnlyOfficeAgent stores that grant in its opaque Office session, calls dpuAgent with Agent Assertion plus the grant, and the router mints a DPU-audience Router Request that carries `usr` claims for ACL evaluation and caller-agent claims for audit.

**Tech Stack:** Node.js ES modules, Ploinky router HTTP services, DS013 Agent Assertion / Router Request JWTs, DS014 MCP policy, OnlyOffice Document Server `9.3.1`, Node's built-in `node:test`, `http`, `net`, `crypto`, and mounted Ploinky Agent helper modules.

---

## Implementation Principles

- Preserve the router-only public boundary: no browser or internet client reaches agent container ports directly except the intentionally public editor asset/WebSocket surface.
- Preserve secret boundaries: OnlyOfficeAgent receives only `PLOINKY_AGENT_ID`, `PLOINKY_AGENT_SECRET`, and `ONLYOFFICE_JWT_SECRET`; it never receives `PLOINKY_MASTER_KEY`, `DPU_MASTER_KEY`, or another agent secret.
- Treat route keys as routing labels and canonical ids as identity: the manifest uses portable `agent:./dpuAgent`, and the router expands delegation grants to `sourceAgentId: "agent:<repo>/onlyOffice"` and `targetAgentId: "agent:<repo>/dpuAgent"` for the installed repo.
- Make delegation explicit and fail-closed: no `delegations` manifest entry means no grant; anonymous/guest HTTP services never receive grants; grants are denied for mismatched source, target, tool, scope, expiry, or MCP policy.
- Keep storage callbacks off the router-facing port: `/internal/document/<token>` and `/internal/callback/<token>` live on a dedicated loopback listener or Unix socket that is not host-published and is not the route `hostPort`.
- Move Office responsibilities out of Explorer after OnlyOfficeAgent proves parity: Explorer initiates "open file" and renders the editor host, but it no longer owns Document Server callback/document routes or DPU persistence.

## B2 Delegation Contract

### Router-minted User Delegation Grant

The router signs this grant with a router-held signing key. The grant is addressed to the router, not to dpuAgent, because only the router may transform it into a target-agent Router Request.

```json
{
  "typ": "user-delegation",
  "iss": "ploinky-router",
  "aud": "ploinky-router",
  "sub": "user:<stable-user-id>",
  "jti": "<random-id>",
  "iat": 1760000000,
  "exp": 1760028800,
  "sourceAgentId": "agent:<repo>/onlyOffice",
  "service": {
    "routeKey": "onlyOffice",
    "externalPrefix": "/services/onlyoffice/",
    "internalPrefix": "/control/",
    "internalPath": "/control/office/session"
  },
  "usr": {
    "id": "local:alice",
    "username": "alice",
    "roles": ["user"]
  },
  "allowedTargets": ["agent:<repo>/dpuAgent"],
  "allowedTools": [
    "dpu_workspace_roots",
    "dpu_confidential_list",
    "dpu_confidential_get",
    "dpu_confidential_update"
  ],
  "scope": ["dpu:confidential:read", "dpu:confidential:write"]
}
```

The router injects the compact JWT into the verified HTTP-service auth-info:

```json
{
  "actor": { "kind": "user", "id": "local:alice", "roles": ["user"] },
  "user": { "id": "local:alice", "username": "alice", "roles": ["user"] },
  "delegations": {
    "dpuConfidential": {
      "token": "<router-signed-user-delegation-jwt>",
      "expiresAt": "2026-06-09T20:00:00.000Z",
      "targetAgentId": "agent:<repo>/dpuAgent",
      "tools": [
        "dpu_workspace_roots",
        "dpu_confidential_list",
        "dpu_confidential_get",
        "dpu_confidential_update"
      ],
      "scope": ["dpu:confidential:read", "dpu:confidential:write"]
    }
  }
}
```

OnlyOfficeAgent stores `delegations.dpuConfidential.token` server-side in the Office session record. It never returns the grant as a top-level browser-visible value, never logs it, and never forwards it to dpuAgent.

### Delegated MCP Request

OnlyOfficeAgent calls dpuAgent through the router:

```http
POST /dpuAgent/mcp HTTP/1.1
Authorization: Bearer <agent-assertion-from-agent:<repo>/onlyOffice>
X-Ploinky-User-Delegation: <router-signed-user-delegation-jwt>
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": "a2a-...",
  "method": "tools/call",
  "params": {
    "name": "dpu_confidential_get",
    "arguments": {
      "id": "dpu-object-id-for-report-docx"
    }
  }
}
```

The router verifies the Agent Assertion first, verifies the User Delegation Grant second, applies the delegation allow-list and MCP policy third, then mints this target Router Request for dpuAgent:

```json
{
  "typ": "router-request",
  "iss": "ploinky-router",
  "aud": "agent:<repo>/dpuAgent",
  "sub": "agent:<repo>/onlyOffice",
  "actor": {
    "kind": "agent",
    "id": "agent:<repo>/onlyOffice",
    "roles": ["agent"]
  },
  "caller": {
    "kind": "agent",
    "id": "agent:<repo>/onlyOffice",
    "roles": ["agent"]
  },
  "usr": {
    "id": "local:alice",
    "username": "alice",
    "roles": ["user"]
  },
  "delegation": {
    "jti": "<grant-jti>",
    "scope": ["dpu:confidential:read", "dpu:confidential:write"],
    "sourceAgentId": "agent:<repo>/onlyOffice"
  },
  "method": "POST",
  "path": "/mcp",
  "tool": "dpu_confidential_get",
  "rch": "<request-hash>"
}
```

DPU already gives `usr` precedence in `authInfoFromInvocation()`. The implementation must keep that behavior and add tests that prove ACLs evaluate the user, not `agent:<repo>/onlyOffice`.

## File Map

### Ploinky Runtime Core

- Create `ploinky/cli/server/mcp-proxy/userDelegationGrant.js`: mint, verify, and validate router-signed User Delegation Grants.
- Modify `ploinky/cli/server/httpServiceRoutes.js`: preserve and validate `delegations` in normalized `httpServices` specs.
- Modify `ploinky/cli/server/routerHandlers.js`: strip caller-supplied delegation headers, mint grants only for protected service routes, and include grants in verified auth-info.
- Modify `ploinky/cli/server/mcp-proxy/index.js`: accept `x-ploinky-user-delegation` only on verified agent-to-agent requests and pass verified delegation context into invocation minting.
- Modify `ploinky/cli/server/mcp-proxy/invocationMinter.js`: build Router Requests with optional `usr`, `caller`, and `delegation` claims.
- Modify `ploinky/cli/server/policy/McpToolPolicy.js`: authorize delegated user calls without making plain agents equivalent to authenticated users.
- Modify `ploinky/Agent/client/AgentMcpClient.mjs`: add optional per-client delegation token transport.
- Modify `ploinky/Agent/lib/invocation-auth.mjs` and `ploinky/Agent/lib/invocationAuth.mjs`: preserve current `usr` precedence and expose `caller`/`delegation` in normalized auth info.
- Modify `ploinky/docs/specs/DS011-security-model.md`, `DS013-per-agent-identity-and-request-signed-jwts.md`, and `DS014-router-access-control-http-whitelist-and-mcp-policy.md`: document B2 as a router-mediated delegation mechanism.

### AssistOSExplorer dpuAgent

- Modify `AssistOSExplorer/dpuAgent/tests/dpu-store.test.mjs`: add user-delegated Confidential read/write ACL tests.
- Modify `AssistOSExplorer/dpuAgent/tests/runtime-contract.test.mjs`: assert retired caller headers are ignored and router `usr` claims are the only delegated user source.
- Modify `AssistOSExplorer/dpuAgent/docs/specs/`: record that dpuAgent accepts delegated user context only when it arrives in a verified Router Request.

### AssistOSExplorer onlyOffice

- Create `AssistOSExplorer/onlyOffice/package.json`: Node test/start scripts for the decorator.
- Create `AssistOSExplorer/onlyOffice/src/index.mjs`: start the decorator control listener, storage listener, public editor proxy, and Document Server process supervisor.
- Create `AssistOSExplorer/onlyOffice/src/config.mjs`: read and validate ports, public URL, workspace root, JWT secret, and session limits.
- Create `AssistOSExplorer/onlyOffice/src/session-store.mjs`: opaque Office session records, idle expiry, absolute delegation expiry, one-time close/delete behavior.
- Create `AssistOSExplorer/onlyOffice/src/http-auth.mjs`: verify router HTTP-service auth-info before trusting identity or delegation data.
- Create `AssistOSExplorer/onlyOffice/src/onlyoffice-config.mjs`: build and HS256-sign editor configs copied from Explorer behavior, with loopback document/callback URLs.
- Create `AssistOSExplorer/onlyOffice/src/storage/path-policy.mjs`: workspace path normalization, root confinement, symlink escape prevention, and `.secrets` exclusion.
- Create `AssistOSExplorer/onlyOffice/src/storage/workspace-store.mjs`: direct disk read/write for non-Confidential paths.
- Create `AssistOSExplorer/onlyOffice/src/storage/dpu-store.mjs`: Confidential metadata/read/write through `AgentMcpClient` plus the stored user delegation token.
- Create `AssistOSExplorer/onlyOffice/src/storage/router.mjs`: choose workspace vs DPU backend using `/Confidential` classification.
- Create `AssistOSExplorer/onlyOffice/src/routes/control.mjs`: `GET /control/office/session`.
- Create `AssistOSExplorer/onlyOffice/src/routes/storage.mjs`: `GET /internal/document/<token>` and `POST /internal/callback/<token>`.
- Create `AssistOSExplorer/onlyOffice/src/proxy/editor-proxy.mjs`: public allow-list proxy for editor assets and the co-editing WebSocket.
- Modify `AssistOSExplorer/onlyOffice/manifest.json`: run the decorator, declare protected `httpServices` with B2 delegation, expose only the public editor port, and keep storage callbacks unpublished.
- Modify `AssistOSExplorer/onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md`: replace thin-wrapper invariant with decorator invariant after implementation.

### AssistOSExplorer Explorer

- Modify `AssistOSExplorer/explorer/services/onlyoffice/onlyoffice-editor-host.js`: call `/services/onlyoffice/office/session` instead of Explorer's Office session endpoint.
- Remove or disable Explorer-owned `/office/document` and `/office/callback` public routes after OnlyOfficeAgent passes parity tests.
- Modify `AssistOSExplorer/explorer/manifest.json`: remove the anonymous `/public-services/explorer/office/` service after cutover.
- Modify `AssistOSExplorer/docs/specs/DS04-onlyoffice-integration.md` and `DS06-ploinky-runtime-invariants.md`: record the new owner and B2 security model.

## Task 1: Normalize HTTP-Service Delegation Specs

**Files:**

- Modify: `ploinky/cli/server/httpServiceRoutes.js`
- Test: `ploinky/tests/unit/httpServiceInvocation.test.mjs`

- [ ] **Step 1: Add failing tests for valid and invalid `delegations`.**

Test names:

```js
test('normalizeServiceSpec preserves protected service delegations with canonical target ids', () => {});
test('normalizeServiceSpec rejects delegations on auth none services', () => {});
test('normalizeServiceSpec rejects delegation targets that are not canonical agent ids', () => {});
test('normalizeServiceSpec rejects empty delegation tool lists', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/httpServiceInvocation.test.mjs
```

Expected: the new tests fail because `normalizeServiceSpec()` currently drops or ignores `delegations`.

- [ ] **Step 2: Implement normalization.**

Behavior to add:

```js
{
  externalPrefix: "/services/onlyoffice/",
  internalPrefix: "/control/",
  auth: "protected",
  delegations: [{
    key: "dpuConfidential",
    targetAgentId: "agent:./dpuAgent",
    tools: [
      "dpu_workspace_roots",
      "dpu_confidential_list",
      "dpu_confidential_get",
      "dpu_confidential_update"
    ],
    scopes: ["dpu:confidential:read", "dpu:confidential:write"],
    ttlSeconds: 28800,
    when: { queryParam: "path", pathRoots: ["/Confidential"] }
  }]
}
```

Validation rules:

- `delegations` is optional and defaults to an empty array.
- A service with delegations must have `auth: "protected"`.
- `targetAgentId` must match `^agent:[^/]+/[^/]+$` or the portable same-repo form `agent:./<agent>`, which expands to `agent:<source-repo>/<agent>`.
- `tools` must be a non-empty array of unique non-empty strings.
- `scopes` must be a non-empty array of unique non-empty strings.
- `ttlSeconds` must be an integer from `30` through `PLOINKY_USER_DELEGATION_MAX_TTL_SECONDS`; missing value defaults to `1800`, while the router-wide ceiling defaults to `28800`.
- `when` is optional. When present for OnlyOffice, it must use `{ queryParam: "path", pathRoots: ["/Confidential"] }` so workspace sessions do not receive a DPU grant.

- [ ] **Step 3: Run the focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/httpServiceInvocation.test.mjs
```

Expected: all `httpServiceInvocation` tests pass.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add ploinky/cli/server/httpServiceRoutes.js ploinky/tests/unit/httpServiceInvocation.test.mjs
git commit -m "feat(ploinky): normalize http service delegations"
```

## Task 2: Add User Delegation Grant Minting And Verification

**Files:**

- Create: `ploinky/cli/server/mcp-proxy/userDelegationGrant.js`
- Test: `ploinky/tests/unit/userDelegationGrant.test.mjs`

- [ ] **Step 1: Add failing grant tests.**

Test names:

```js
test('mintUserDelegationGrant signs a source-bound router-audience grant', () => {});
test('verifyUserDelegationGrant rejects wrong typ, issuer, and audience', () => {});
test('verifyUserDelegationGrant rejects expired grants', () => {});
test('verifyUserDelegationGrant rejects source, target, and tool mismatches', () => {});
test('verifyUserDelegationGrant rejects guests and missing usr claims', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/userDelegationGrant.test.mjs
```

Expected: failure because the file and exports do not exist.

- [ ] **Step 2: Implement the module contract.**

Exports:

```js
export function mintUserDelegationGrant({
  signingSecret,
  now = new Date(),
  ttlSeconds,
  sourceAgentId,
  service,
  user,
  targetAgentId,
  tools,
  scopes
}) {}

export function verifyUserDelegationGrant({
  signingSecret,
  token,
  now = new Date(),
  expectedSourceAgentId,
  expectedTargetAgentId,
  expectedTool
}) {}
```

Implementation requirements:

- Use HS256 with the same compact JWT conventions as existing Ploinky JWT helpers.
- Generate `jti` with cryptographically strong randomness.
- Store user identity under `usr`; do not accept `actor.kind: "agent"` or `actor.kind: "guest"` as a delegated user.
- Return `{ claims, user: claims.usr, delegation: { jti, scope, sourceAgentId, targetAgentId, tool } }` after verification.
- Throw typed `Error` objects with stable messages: `delegation typ mismatch`, `delegation audience mismatch`, `delegation expired`, `delegation source mismatch`, `delegation target mismatch`, `delegation tool not allowed`, and `delegation user missing`.

- [ ] **Step 3: Run the focused grant tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/userDelegationGrant.test.mjs
```

Expected: all grant tests pass.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add ploinky/cli/server/mcp-proxy/userDelegationGrant.js ploinky/tests/unit/userDelegationGrant.test.mjs
git commit -m "feat(ploinky): add router user delegation grants"
```

## Task 3: Mint Grants For Protected Office HTTP Services

**Files:**

- Modify: `ploinky/cli/server/routerHandlers.js`
- Test: `ploinky/tests/unit/httpServiceInvocation.test.mjs`

- [ ] **Step 1: Add failing HTTP-service grant tests.**

Test names:

```js
test('protected http service auth info includes configured user delegation grant', () => {});
test('http service grant is omitted for anonymous and guest actors', () => {});
test('router strips caller-supplied x-ploinky-user-delegation before proxying', () => {});
test('http service grant expiry is capped by the service delegation ttl', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/httpServiceInvocation.test.mjs
```

Expected: failure because auth-info does not include `delegations.dpuConfidential` and the new header is not stripped.

- [ ] **Step 2: Add minting to `buildHttpServiceAuthInfoHeader()`.**

Required behavior:

- Mint grants only after the normal user session verifies.
- Use the normalized service route's `delegations` entries.
- Include each grant under `authInfo.delegations` with a deterministic key. For OnlyOffice use `dpuConfidential`.
- Include only compact grant metadata plus the compact token; do not include signing secrets or raw cookies.
- Strip client-supplied `x-ploinky-user-delegation` anywhere the router already strips `x-ploinky-*` identity headers.

- [ ] **Step 3: Run the focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/httpServiceInvocation.test.mjs
```

Expected: all HTTP-service invocation tests pass.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add ploinky/cli/server/routerHandlers.js ploinky/tests/unit/httpServiceInvocation.test.mjs
git commit -m "feat(ploinky): mint delegation grants for protected services"
```

## Task 4: Authorize Delegated Agent-to-Agent MCP Calls

**Files:**

- Modify: `ploinky/cli/server/mcp-proxy/index.js`
- Modify: `ploinky/cli/server/mcp-proxy/invocationMinter.js`
- Modify: `ploinky/cli/server/policy/McpToolPolicy.js`
- Test: `ploinky/tests/unit/mcpToolPolicy.test.mjs`
- Test: `ploinky/tests/unit/mcpProxyDelegation.test.mjs`

- [ ] **Step 1: Add failing policy tests.**

Test names:

```js
test('plain agent is denied for authenticated tools', () => {});
test('agent with verified user delegation may call listed authenticated tool', () => {});
test('delegated agent is denied for tools outside the grant', () => {});
test('delegated agent is denied when mcp policy denies the source target tool tuple', () => {});
test('delegated agent does not gain admin or internal access', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/mcpToolPolicy.test.mjs
```

Expected: the delegated-user tests fail while existing plain-agent deny tests continue to pass.

- [ ] **Step 2: Add failing proxy/minting tests.**

Test names:

```js
test('mcp proxy verifies agent assertion before user delegation grant', () => {});
test('mcp proxy mints router request with caller agent and usr user claims', () => {});
test('mcp proxy rejects a valid grant from the wrong source agent', () => {});
test('mcp proxy rejects a grant for the wrong target agent', () => {});
test('mcp proxy rejects replayed or expired delegation grants', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/mcpProxyDelegation.test.mjs
```

Expected: failure because the proxy does not parse `x-ploinky-user-delegation`.

- [ ] **Step 3: Implement policy and Router Request minting.**

Required behavior:

- Only the agent-to-agent path accepts `x-ploinky-user-delegation`.
- The proxy verifies Agent Assertion first and derives `sourceAgentId` from the assertion.
- The proxy verifies the delegation grant using `expectedSourceAgentId`, canonical target agent id, and requested tool.
- MCP policy receives both the source agent and verified delegated user context.
- A delegated user may satisfy `authenticated` only for the exact tool covered by the verified grant and policy.
- The target Router Request includes `caller`, `usr`, and `delegation` claims exactly as specified in this plan's B2 contract.

- [ ] **Step 4: Run focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/mcpToolPolicy.test.mjs tests/unit/mcpProxyDelegation.test.mjs
```

Expected: all policy and proxy delegation tests pass.

- [ ] **Step 5: Commit checkpoint.**

```bash
git add ploinky/cli/server/mcp-proxy/index.js ploinky/cli/server/mcp-proxy/invocationMinter.js ploinky/cli/server/policy/McpToolPolicy.js ploinky/tests/unit/mcpToolPolicy.test.mjs ploinky/tests/unit/mcpProxyDelegation.test.mjs
git commit -m "feat(ploinky): authorize delegated user mcp calls"
```

## Task 5: Add Delegation Transport To AgentMcpClient

**Files:**

- Modify: `ploinky/Agent/client/AgentMcpClient.mjs`
- Test: `ploinky/tests/unit/agentMcpClient.test.mjs`

- [ ] **Step 1: Add failing client tests.**

Test names:

```js
test('createAgentClient sends no delegation header by default', () => {});
test('createAgentClient sends x-ploinky-user-delegation when configured', () => {});
test('per-call delegation token overrides client delegation token', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/agentMcpClient.test.mjs
```

Expected: failure because the client cannot send a delegation token.

- [ ] **Step 2: Implement the client API.**

Target shape:

```js
const client = await createAgentClient('dpuAgent', {
  userDelegationToken: session.delegations.dpuConfidential.token
});

await client.callTool('dpu_confidential_get', args);
await client.callTool('dpu_confidential_update', args, {
  userDelegationToken: refreshedToken
});
```

Rules:

- Reject non-string tokens before sending a request.
- Do not log the token.
- Keep the default behavior unchanged when no token is configured.

- [ ] **Step 3: Run focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/agentMcpClient.test.mjs
```

Expected: all client tests pass.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add ploinky/Agent/client/AgentMcpClient.mjs ploinky/tests/unit/agentMcpClient.test.mjs
git commit -m "feat(ploinky): carry user delegation on agent mcp calls"
```

## Task 6: Lock DPU ACL Behavior To Router `usr` Claims

**Files:**

- Modify: `AssistOSExplorer/dpuAgent/tests/dpu-store.test.mjs`
- Modify: `AssistOSExplorer/dpuAgent/tests/runtime-contract.test.mjs`

- [ ] **Step 1: Add failing or characterization tests for delegated Confidential access.**

Test names:

```js
test('delegated confidential get uses usr as the acting principal', () => {});
test('delegated confidential update uses usr as the acting principal', () => {});
test('agent caller without usr cannot satisfy user-owned confidential acl', () => {});
test('legacy x-ploinky-caller-jwt does not create delegated user identity', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/dpuAgent
npm test
```

Expected: tests either pass as characterization of existing `usr` precedence or fail where legacy caller-header assumptions still exist.

- [ ] **Step 2: Remove any remaining trust in retired caller headers.**

Required behavior:

- DPU derives acting user only from verified Router Request auth info.
- `caller` may be recorded for audit, but ACL checks use `usr` when present.
- A Router Request with only `actor.kind: "agent"` cannot read or write user-owned `/Confidential` files.

- [ ] **Step 3: Run dpuAgent tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/dpuAgent
npm test
```

Expected: all dpuAgent tests pass.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add AssistOSExplorer/dpuAgent/tests/dpu-store.test.mjs AssistOSExplorer/dpuAgent/tests/runtime-contract.test.mjs
git commit -m "test(dpu): lock delegated user acl semantics"
```

## Task 7: Scaffold OnlyOfficeAgent Decorator Runtime

**Files:**

- Create: `AssistOSExplorer/onlyOffice/package.json`
- Create: `AssistOSExplorer/onlyOffice/src/index.mjs`
- Create: `AssistOSExplorer/onlyOffice/src/config.mjs`
- Create: `AssistOSExplorer/onlyOffice/src/session-store.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/session-store.test.mjs`
- Modify: `AssistOSExplorer/onlyOffice/manifest.json`

- [ ] **Step 1: Add failing session/config tests.**

Test names:

```js
test('config rejects missing onlyoffice jwt secret', () => {});
test('session store mints opaque tokens and never exposes delegation tokens in summaries', () => {});
test('session store expires at the earlier of idle timeout and delegation expiry', () => {});
test('session store rejects document access after absolute delegation expiry', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test
```

Expected: failure because the package and source files do not exist.

- [ ] **Step 2: Create `package.json`.**

Required scripts:

```json
{
  "type": "module",
  "scripts": {
    "start": "node src/index.mjs",
    "test": "node --test tests/**/*.test.mjs"
  }
}
```

- [ ] **Step 3: Implement config and session store.**

Required session shape:

```js
{
  tokenHash: "<sha256-token-hash>",
  path: "/workspace/report.docx",
  storageKind: "workspace",
  storageId: "/workspace/report.docx",
  fileName: "report.docx",
  canWrite: true,
  canComment: true,
  versionKey: "<storage-version>",
  authUser: { id: "local:alice", username: "alice", roles: ["user"] },
  delegations: {
    dpuConfidential: {
      token: "<compact-jwt>",
      expiresAt: "2026-06-09T12:30:00.000Z"
    }
  },
  createdAt: "2026-06-09T12:00:00.000Z",
  idleExpiresAt: "2026-06-09T12:30:00.000Z",
  absoluteExpiresAt: "2026-06-09T12:30:00.000Z"
}
```

Rules:

- Store only a hash of the opaque document/callback token.
- Cap idle extension at `absoluteExpiresAt`.
- `publicSummary()` omits grant tokens, auth-info, and document bytes.
- `getForStorageRequest(token)` rejects expired and unknown tokens.

- [ ] **Step 4: Update manifest runtime intent.**

Manifest requirements:

- The start command runs `npm start` or `node src/index.mjs`.
- `httpServices` contains only the protected `/services/onlyoffice/` -> `/control/` mapping with B2 delegations.
- No anonymous Office document or callback routes exist.
- Public editor port is separate from control route hostPort.
- Storage callback port is not listed in `ports`.

- [ ] **Step 5: Run focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test
```

Expected: all scaffold tests pass.

- [ ] **Step 6: Commit checkpoint.**

```bash
git add AssistOSExplorer/onlyOffice/package.json AssistOSExplorer/onlyOffice/src/index.mjs AssistOSExplorer/onlyOffice/src/config.mjs AssistOSExplorer/onlyOffice/src/session-store.mjs AssistOSExplorer/onlyOffice/tests/session-store.test.mjs AssistOSExplorer/onlyOffice/manifest.json
git commit -m "feat(onlyoffice): scaffold decorator runtime"
```

## Task 8: Implement Office Session Control Route

**Files:**

- Create: `AssistOSExplorer/onlyOffice/src/http-auth.mjs`
- Create: `AssistOSExplorer/onlyOffice/src/onlyoffice-config.mjs`
- Create: `AssistOSExplorer/onlyOffice/src/routes/control.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/control-route.test.mjs`

- [ ] **Step 1: Add failing control-route tests.**

Test names:

```js
test('office session route rejects forged auth-info without invocation token', () => {});
test('office session route rejects auth-info when invocation path does not match', () => {});
test('office session route requires dpuConfidential delegation for Confidential paths', () => {});
test('office session route builds signed config with loopback document and callback urls', () => {});
test('office session route does not return delegation tokens to the browser', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/control-route.test.mjs
```

Expected: failure because the route is not implemented.

- [ ] **Step 2: Implement auth verification.**

Required behavior:

- Use `verifyHttpServiceAuthInfoFromHeaders()` from mounted Ploinky/AssistOS helper code.
- Trust `authInfo.user` and `authInfo.delegations` only after the invocation token verifies.
- Return `401` for missing/invalid invocation tokens and `403` for authenticated users who lack a needed delegation grant.

- [ ] **Step 3: Implement config signing.**

Required behavior:

- Preserve Explorer's current HS256 signing behavior.
- Build `document.url` as `http://127.0.0.1:${ONLYOFFICE_STORAGE_PORT}/internal/document/${token}`.
- Build `editorConfig.callbackUrl` as `http://127.0.0.1:${ONLYOFFICE_STORAGE_PORT}/internal/callback/${token}`.
- Return `documentServerUrl` as the public editor base.
- Do not include raw path, auth-info, or delegation token outside the signed config and opaque session id.

- [ ] **Step 4: Run focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/control-route.test.mjs
```

Expected: all control-route tests pass.

- [ ] **Step 5: Commit checkpoint.**

```bash
git add AssistOSExplorer/onlyOffice/src/http-auth.mjs AssistOSExplorer/onlyOffice/src/onlyoffice-config.mjs AssistOSExplorer/onlyOffice/src/routes/control.mjs AssistOSExplorer/onlyOffice/tests/control-route.test.mjs
git commit -m "feat(onlyoffice): add authenticated office session route"
```

## Task 9: Implement Path-Confined Workspace Storage

**Files:**

- Create: `AssistOSExplorer/onlyOffice/src/storage/path-policy.mjs`
- Create: `AssistOSExplorer/onlyOffice/src/storage/workspace-store.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/path-policy.test.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/workspace-store.test.mjs`

- [ ] **Step 1: Add failing path policy tests.**

Test names:

```js
test('workspace path policy accepts paths inside the workspace root', () => {});
test('workspace path policy rejects dot dot traversal', () => {});
test('workspace path policy rejects nul bytes', () => {});
test('workspace path policy rejects symlink escapes outside the workspace root', () => {});
test('workspace path policy rejects .secrets and star dot secrets files', () => {});
test('workspace path policy rejects /Confidential because dpu storage owns it', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/path-policy.test.mjs
```

Expected: failure because the policy module does not exist.

- [ ] **Step 2: Implement path policy.**

Required behavior:

- Resolve requested paths against the configured workspace root.
- Use `realpath` for existing parents and prevent symlink escape.
- Reject NUL bytes, `..` traversal, absolute paths outside the root, `.secrets`, and files ending in `.secrets`.
- Return `{ absolutePath, relativePath }` for accepted paths.

- [ ] **Step 3: Add workspace store tests.**

Test names:

```js
test('workspace store reads document bytes and version key', () => {});
test('workspace store writes callback bytes atomically inside the workspace root', () => {});
test('workspace store rejects writes when canWrite is false', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/workspace-store.test.mjs
```

Expected: failure before `workspace-store.mjs` exists.

- [ ] **Step 4: Implement workspace store.**

Required behavior:

- Read bytes with `fs.readFile`.
- Write bytes to a temporary file in the same directory and rename over the target.
- Preserve file extension and use the path policy for every operation.
- Return a version key derived from file size, mtime, and a content hash.

- [ ] **Step 5: Run focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/path-policy.test.mjs tests/workspace-store.test.mjs
```

Expected: path policy and workspace store tests pass.

- [ ] **Step 6: Commit checkpoint.**

```bash
git add AssistOSExplorer/onlyOffice/src/storage/path-policy.mjs AssistOSExplorer/onlyOffice/src/storage/workspace-store.mjs AssistOSExplorer/onlyOffice/tests/path-policy.test.mjs AssistOSExplorer/onlyOffice/tests/workspace-store.test.mjs
git commit -m "feat(onlyoffice): add path-confined workspace storage"
```

## Task 10: Implement DPU Storage Adapter With B2 Delegation

**Files:**

- Create: `AssistOSExplorer/onlyOffice/src/storage/dpu-store.mjs`
- Create: `AssistOSExplorer/onlyOffice/src/storage/router.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/dpu-store.test.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/storage-router.test.mjs`

- [ ] **Step 1: Add failing DPU adapter tests.**

Test names:

```js
test('dpu store calls dpu_confidential_get with stored delegation token', () => {});
test('dpu store calls dpu_confidential_update with stored delegation token', () => {});
test('dpu store rejects Confidential access when delegation token is missing', () => {});
test('dpu store rejects Confidential access after delegation expiry', () => {});
test('storage router sends /Confidential/My Space paths to dpu store', () => {});
test('storage router sends non-Confidential paths to workspace store', () => {});
test('storage router rejects /Confidential/Secrets paths', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/dpu-store.test.mjs tests/storage-router.test.mjs
```

Expected: failure because the adapter modules do not exist.

- [ ] **Step 2: Implement DPU adapter.**

Required behavior:

- Use `createAgentClient('dpuAgent', { userDelegationToken })`.
- Resolve virtual Confidential paths to DPU object ids with the same logic as Explorer's `resolveDpuConfidentialNodeAtPath()`:
  - `dpu_workspace_roots` for `/Confidential/My Space`.
  - `dpu_confidential_list` with `{ scope: "my-space", parentId }` for My Space descendants.
  - `dpu_confidential_list` with `{ scope: "shared" }` plus shared-entry virtual name annotation for `/Confidential/Shared`.
- Call `dpu_confidential_get` with `{ id }`; current DPU schema does not accept a path argument.
- Call `dpu_confidential_update` with `{ id, content, mimeType }`, where `content` is base64 text and `id` is the resolved DPU object id.
- Convert base64 to/from `Buffer`.
- Map DPU permission metadata to `canWrite` and `canComment`.
- Do not cache Confidential document bytes outside the session lifetime.

- [ ] **Step 3: Implement storage router.**

Required behavior:

- Use the same `/Confidential` predicate as Explorer's `isDpuVirtualPath`.
- Reject `/Confidential/Secrets`.
- Return a backend object with `read`, `write`, and `metadata` methods.

- [ ] **Step 4: Run focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/dpu-store.test.mjs tests/storage-router.test.mjs
```

Expected: DPU adapter and storage router tests pass.

- [ ] **Step 5: Commit checkpoint.**

```bash
git add AssistOSExplorer/onlyOffice/src/storage/dpu-store.mjs AssistOSExplorer/onlyOffice/src/storage/router.mjs AssistOSExplorer/onlyOffice/tests/dpu-store.test.mjs AssistOSExplorer/onlyOffice/tests/storage-router.test.mjs
git commit -m "feat(onlyoffice): route confidential storage through dpu delegation"
```

## Task 11: Implement Localhost Document And Callback Routes

**Files:**

- Create: `AssistOSExplorer/onlyOffice/src/routes/storage.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/storage-routes.test.mjs`

- [ ] **Step 1: Add failing storage route tests.**

Test names:

```js
test('document route streams bytes for a valid unexpired token', () => {});
test('document route rejects expired and unknown tokens', () => {});
test('callback route persists only status 2 and status 6 save events', () => {});
test('callback route rewrites public download url to internal download url before fetching', () => {});
test('callback route rejects non-loopback peers', () => {});
test('callback route never accepts x-ploinky-auth-info as storage authorization', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/storage-routes.test.mjs
```

Expected: failure because storage routes do not exist.

- [ ] **Step 2: Implement storage routes.**

Required behavior:

- Bind only to `127.0.0.1` or a Unix socket.
- Reject any remote address that is not loopback.
- Use only the opaque session token for document/callback lookup.
- Fetch OnlyOffice callback `url` through the configured internal Document Server base when the public and internal bases differ.
- Persist only callback statuses that represent a saved document.
- Return the OnlyOffice-required JSON response shape, including `{"error":0}` on successful save handling.

- [ ] **Step 3: Run focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/storage-routes.test.mjs
```

Expected: storage route tests pass.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add AssistOSExplorer/onlyOffice/src/routes/storage.mjs AssistOSExplorer/onlyOffice/tests/storage-routes.test.mjs
git commit -m "feat(onlyoffice): add loopback document callback routes"
```

## Task 12: Implement Public Editor Proxy And WebSocket Handling

**Files:**

- Create: `AssistOSExplorer/onlyOffice/src/proxy/editor-proxy.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/editor-proxy.test.mjs`

- [ ] **Step 1: Add failing proxy allow/block tests.**

Test names:

```js
test('editor proxy allows api js and editor asset prefixes', () => {});
test('editor proxy forwards websocket upgrades under /doc/', () => {});
test('editor proxy blocks command service from the internet', () => {});
test('editor proxy blocks convert service from the internet', () => {});
test('editor proxy blocks example welcome info internal and healthcheck endpoints', () => {});
test('editor proxy does not forward x-ploinky-auth-info or x-ploinky-user-delegation', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/editor-proxy.test.mjs
```

Expected: failure because the proxy does not exist.

- [ ] **Step 2: Implement proxy allow-list.**

Public allow-list:

- `GET /web-apps/apps/api/documents/api.js`
- `GET /web-apps/*`
- `GET /sdkjs/*`
- `GET /sdkjs-plugins/*`
- `GET /fonts/*`
- `GET /themes/*`
- `GET /cache/files/*`
- `GET`/`Upgrade` for `/doc/*` WebSocket paths

Public block-list:

- `/coauthoring/CommandService.ashx`
- `/ConvertService.ashx`
- `/converter`
- `/example/*`
- `/welcome/*`
- `/info/*`
- `/internal/*`
- `/healthcheck`

Rules:

- Forward allowed HTTP with Node's `http.request`.
- Forward allowed WebSocket upgrades with `net.connect` to the Document Server listener.
- Remove all incoming `x-ploinky-*` headers before proxying to Document Server.
- Return `404` for blocked and unknown paths.

- [ ] **Step 3: Run focused tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/editor-proxy.test.mjs
```

Expected: editor proxy tests pass.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add AssistOSExplorer/onlyOffice/src/proxy/editor-proxy.mjs AssistOSExplorer/onlyOffice/tests/editor-proxy.test.mjs
git commit -m "feat(onlyoffice): proxy public editor surface only"
```

## Task 13: Wire Explorer To OnlyOfficeAgent

**Files:**

- Modify: `AssistOSExplorer/explorer/services/onlyoffice/onlyoffice-editor-host.js`
- Modify: `AssistOSExplorer/explorer/utils/server/onlyoffice/onlyoffice-http-routes.mjs`
- Modify: `AssistOSExplorer/explorer/manifest.json`
- Modify: `AssistOSExplorer/explorer/tests/unit/onlyoffice*.test.js`

- [ ] **Step 1: Add failing Explorer integration tests.**

Test names:

```js
test('editor host opens sessions through /services/onlyoffice/office/session', () => {});
test('explorer manifest no longer declares anonymous public office document routes', () => {});
test('explorer server does not register office document or callback routes after cutover', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
npm test
```

Expected: the new tests fail while Explorer still points at its own Office routes.

- [ ] **Step 2: Update Explorer Office entrypoint.**

Required behavior:

- The browser asks the router for `/services/onlyoffice/office/session?path=<encoded-path>`.
- Explorer no longer builds OnlyOffice config, document URLs, or callback URLs.
- Explorer no longer calls dpuAgent for Office persistence.
- Existing non-Office filesystem and DPU Explorer behavior remains unchanged.

- [ ] **Step 3: Remove anonymous Office routes from Explorer manifest.**

Required behavior:

- Delete the `/public-services/explorer/office/` httpService.
- Delete the protected `/services/explorer/office/` httpService when no remaining Explorer code uses it.
- Keep unrelated Explorer services unchanged.

- [ ] **Step 4: Run Explorer tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
npm test
```

Expected: Explorer tests pass and no anonymous Office route remains in the manifest.

- [ ] **Step 5: Commit checkpoint.**

```bash
git add AssistOSExplorer/explorer/services/onlyoffice/onlyoffice-editor-host.js AssistOSExplorer/explorer/utils/server/onlyoffice/onlyoffice-http-routes.mjs AssistOSExplorer/explorer/manifest.json AssistOSExplorer/explorer/tests
git commit -m "feat(explorer): route office sessions to onlyoffice agent"
```

## Task 14: Runtime Smoke Tests And End-To-End Coverage

**Files:**

- Create: `AssistOSExplorer/onlyOffice/tests/e2e/onlyofficeagent.e2e.test.mjs`
- Create: `AssistOSExplorer/onlyOffice/tests/e2e/router-delegation.e2e.test.mjs`
- Modify: local test harness scripts only when a reusable harness already exists in the repo.

- [ ] **Step 1: Add e2e smoke tests.**

Test names:

```js
test('authenticated user opens and saves workspace docx through OnlyOfficeAgent', () => {});
test('authenticated user opens and saves Confidential docx through delegated dpuAgent', () => {});
test('user without Confidential acl cannot open another user document', () => {});
test('internet cannot reach internal document route through office host', () => {});
test('internet cannot reach internal document route through generic router agent path', () => {});
test('public editor host serves api js and websocket upgrade while blocking admin endpoints', () => {});
```

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/e2e/*.test.mjs
```

Expected: tests fail until the full runtime is wired.

- [ ] **Step 2: Implement the runtime harness.**

Harness requirements:

- Start Ploinky router and the three agents: `explorer`, `onlyOffice`, and `dpuAgent`.
- Create two local users with different Confidential ACLs.
- Seed one workspace Office file and one `/Confidential/My Space` Office file.
- Exercise session creation with real router auth headers.
- Use callback-route tests for save behavior when a real Document Server is too heavy for unit CI; run full browser/Document Server smoke in nightly or release validation.

- [ ] **Step 3: Run e2e smoke tests.**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test -- tests/e2e/*.test.mjs
```

Expected: e2e tests pass in the documented local runtime profile.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add AssistOSExplorer/onlyOffice/tests/e2e
git commit -m "test(onlyoffice): add delegated office e2e coverage"
```

## Task 15: Resynchronize DS Specs And Generated Docs

**Files:**

- Modify: `ploinky/docs/specs/DS011-security-model.md`
- Modify: `ploinky/docs/specs/DS013-per-agent-identity-and-request-signed-jwts.md`
- Modify: `ploinky/docs/specs/DS014-router-access-control-http-whitelist-and-mcp-policy.md`
- Modify: `AssistOSExplorer/onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md`
- Modify: `AssistOSExplorer/docs/specs/DS04-onlyoffice-integration.md`
- Modify: `AssistOSExplorer/docs/specs/DS06-ploinky-runtime-invariants.md`
- Modify: affected `docs/specs/matrix.md` and generated `docs/index.html` files after running the repo documentation process.

- [ ] **Step 1: Update Ploinky DS specs.**

Required DS content:

- DS011 defines User Delegation Grant as router-issued and router-verified; it is reusable within its source/target/tool/scope/TTL bounds, while Agent Assertions and Router Requests remain per-call replay-protected.
- DS013 states agents still receive only their own secret and cannot mint user delegation.
- DS014 states MCP policy remains fail-closed and delegated user access is narrower than plain authenticated user access because it is tool/scoped and source-bound.

- [ ] **Step 2: Update AssistOSExplorer DS specs.**

Required DS content:

- OnlyOfficeAgent owns Office session/config/document/callback/persistence routing.
- Browser editor talks only to OnlyOfficeAgent for Office runtime.
- Confidential Office persistence uses dpuAgent encrypted-at-rest storage with router-minted user delegation.
- Explorer no longer exposes anonymous Office document/callback routes.

- [ ] **Step 3: Regenerate or verify documentation indexes.**

Run the repository's documented specs/docs process. If no single command exists, run the existing link/index generation commands named by the repo's docs. Record the exact command in the implementation PR description.

- [ ] **Step 4: Commit checkpoint.**

```bash
git add ploinky/docs/specs AssistOSExplorer/onlyOffice/docs/specs AssistOSExplorer/docs/specs AssistOSExplorer/onlyOffice/docs/index.html AssistOSExplorer/docs/index.html
git commit -m "docs: document onlyoffice delegated architecture"
```

## Task 16: Final Verification Suite

Run these commands from a clean worktree after all implementation commits are present:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/httpServiceInvocation.test.mjs tests/unit/userDelegationGrant.test.mjs tests/unit/mcpToolPolicy.test.mjs tests/unit/mcpProxyDelegation.test.mjs tests/unit/agentMcpClient.test.mjs
```

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/dpuAgent
npm test
```

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test
```

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
npm test
```

Security smoke commands:

```bash
curl -i https://<router-host>/onlyOffice/internal/document/not-a-real-token
curl -i https://<office-host>/internal/document/not-a-real-token
curl -i https://<office-host>/coauthoring/CommandService.ashx
curl -i https://<office-host>/ConvertService.ashx
curl -i https://<office-host>/web-apps/apps/api/documents/api.js
```

Expected results:

- Both `/internal/document` probes fail with connection refused, `404`, or `403`; they must not return document bytes.
- Command and convert service probes are blocked from the internet.
- `api.js` returns `200`.
- Workspace and Confidential Office save flows pass.
- DPU encrypted blobs remain `DPUENC1:` ciphertext.
- A user without the DPU ACL is denied even when OnlyOfficeAgent is the caller.
- Environment inspection shows no `PLOINKY_MASTER_KEY`, `PLOINKY_DERIVED_MASTER_KEY`, or `DPU_MASTER_KEY` in OnlyOfficeAgent.

## Test Suite Matrix

| Area | Test file | Critical assertions |
| --- | --- | --- |
| HTTP service delegation parsing | `ploinky/tests/unit/httpServiceInvocation.test.mjs` | canonical target ids; protected-only grants; header stripping; TTL cap |
| Grant JWT contract | `ploinky/tests/unit/userDelegationGrant.test.mjs` | typ/iss/aud/exp/jti; source/target/tool matching; no guest grants |
| MCP policy | `ploinky/tests/unit/mcpToolPolicy.test.mjs` | plain agent denied for authenticated tools; delegated user allowed only by exact grant and policy |
| MCP proxy | `ploinky/tests/unit/mcpProxyDelegation.test.mjs` | Agent Assertion verified before grant; Router Request carries `caller`, `usr`, and delegation metadata |
| Agent client | `ploinky/tests/unit/agentMcpClient.test.mjs` | delegation header absent by default; present only when configured; no token logging |
| DPU ACL | `AssistOSExplorer/dpuAgent/tests/dpu-store.test.mjs` | `usr` principal controls Confidential read/write; agent-only actor denied |
| DPU runtime contract | `AssistOSExplorer/dpuAgent/tests/runtime-contract.test.mjs` | retired caller headers ignored; verified Router Request is the only delegated source |
| OnlyOffice session | `AssistOSExplorer/onlyOffice/tests/session-store.test.mjs` | opaque tokens; no grant leakage; expiry capped by delegation expiry |
| OnlyOffice control | `AssistOSExplorer/onlyOffice/tests/control-route.test.mjs` | auth-info invocation token required; loopback document/callback URLs; signed config |
| Path policy | `AssistOSExplorer/onlyOffice/tests/path-policy.test.mjs` | traversal, NUL, symlink escape, `.secrets`, and `/Confidential/Secrets` rejected |
| Workspace store | `AssistOSExplorer/onlyOffice/tests/workspace-store.test.mjs` | atomic direct-disk read/write inside workspace root |
| DPU store adapter | `AssistOSExplorer/onlyOffice/tests/dpu-store.test.mjs` | delegated `dpu_confidential_get/update`; missing/expired grant denied |
| Storage router | `AssistOSExplorer/onlyOffice/tests/storage-router.test.mjs` | `/Confidential` to DPU; non-Confidential to disk |
| Storage callbacks | `AssistOSExplorer/onlyOffice/tests/storage-routes.test.mjs` | loopback-only; opaque-token-only; save statuses handled |
| Editor proxy | `AssistOSExplorer/onlyOffice/tests/editor-proxy.test.mjs` | assets and WebSocket allowed; admin/convert/demo/internal endpoints blocked |
| Explorer cutover | `AssistOSExplorer/explorer/tests/unit/onlyoffice*.test.js` | Explorer points to OnlyOfficeAgent; anonymous Office routes gone |
| End-to-end | `AssistOSExplorer/onlyOffice/tests/e2e/*.test.mjs` | workspace edit/save, Confidential edit/save, ACL denial, public/internal path separation |

## Implementation Gate Order

1. Ploinky B2 grant and policy tests must pass before OnlyOfficeAgent can persist Confidential files.
2. DPU `usr` ACL tests must pass before moving Explorer's Confidential Office path to OnlyOfficeAgent.
3. OnlyOfficeAgent unit tests must pass before changing Explorer's session endpoint.
4. Public proxy/blocklist tests must pass before exposing the editor host to the internet.
5. End-to-end workspace and Confidential save tests must pass before deleting Explorer's anonymous Office routes.
6. Specs must be resynchronized in the same implementation branch before review.

## Final PR Checklist

- [ ] No `auth: "none"` Office document/callback route remains in Explorer or OnlyOfficeAgent manifests.
- [ ] No `/internal/document` or `/internal/callback` listener is host-published or attached to the router route hostPort.
- [ ] OnlyOfficeAgent manifest uses portable delegation target id `agent:./dpuAgent`, which the router expands to canonical `agent:<repo>/dpuAgent`.
- [ ] OnlyOfficeAgent environment excludes `PLOINKY_MASTER_KEY`, `PLOINKY_DERIVED_MASTER_KEY`, and `DPU_MASTER_KEY`.
- [ ] `x-ploinky-auth-info` is trusted only after invocation-token verification.
- [ ] `x-ploinky-user-delegation` is stripped from external requests and accepted only on verified agent-to-agent MCP calls.
- [ ] DPU ACL traces show the acting user from `usr`, with OnlyOfficeAgent preserved as caller.
- [ ] Public editor proxy allows `api.js` and co-editing WebSocket while blocking command, convert, demo, info, internal, and healthcheck endpoints.
- [ ] Workspace path tests cover traversal, NUL, symlink escape, `.secrets`, and `/Confidential/Secrets`.
- [ ] DS specs and generated docs describe the implemented behavior.
