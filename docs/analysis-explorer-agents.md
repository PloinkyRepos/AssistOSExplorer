# AssistOS Explorer — Agent Architecture Analysis

> Date: 2026-04-02 | Scope: gitAgent, dpuAgent, secrets management 

---

## Table of Contents

1. [Git Agent — User Identity for Commits](#1-git-agent--user-identity-for-commits)
2. [DPU Agent — Full Code Review](#2-dpu-agent--full-code-review)
3. [Secrets Management — Derived Master Feasibility](#3-secrets-management--derived-master-feasibility)

---

## 1. Git Agent — User Identity for Commits

### How It Works Today

The gitAgent (`gitMCP`) already supports per-commit user identity via optional `userName`/`userEmail` parameters on the `git_commit` tool.

**`gitAgent/lib/git-service.mjs:806-822`** — commit function:
```javascript
async function gitCommit({ path, message, amend, signoff, userName = null, userEmail = null }) {
  const args = [gitBinary];
  if (userName)  args.push('-c', `user.name=${userName}`);
  if (userEmail) args.push('-c', `user.email=${userEmail}`);
  args.push('commit');
  // ...
}
```

**`gitAgent/mcp-config.json:291-325`** — tool schema already declares:
```json
{
  "name": "git_commit",
  "inputSchema": {
    "userName":  { "type": "string", "optional": true },
    "userEmail": { "type": "string", "optional": true }
  }
}
```

A separate `git_set_identity` tool can persist identity to repo-level config:
```json
{
  "name": "git_set_identity",
  "inputSchema": {
    "path":  { "type": "string" },
    "scope": { "type": "string", "optional": true },  // "local" or "global"
    "name":  { "type": "string" },
    "email": { "type": "string" }
  }
}
```

### How WebStorm Does It

**OAuth:** JetBrains owns a pre-registered **GitHub OAuth App** that uses the **Authorization Code flow**:
1. IDE opens browser → `github.com/login/oauth/authorize?client_id=<jetbrains_id>`
2. User authorizes → GitHub redirects to `account.jetbrains.com/github/oauth/intellij/complete`
3. JetBrains callback server exchanges code for token (holds `client_secret` server-side)
4. Token passed back to IDE via local `127.0.0.1` listener
5. Scopes: `repo`, `gist`, `read:org`

**Push/Pull:** IDE injects the OAuth token as HTTPS credentials via its built-in credential helper. SSH remotes delegate to the system SSH agent.

**Commit Identity:** WebStorm does NOT pull identity from GitHub. It relies entirely on `git config user.name`/`user.email` (local → global → system). If missing, git refuses to commit and the IDE prompts the user to configure it.

### How gitAgent Already Does It (Device Flow)

The gitAgent has its own GitHub OAuth implementation using the **Device Flow** (RFC 8628). This is the right choice because git operations run in the agent container (server-side) while the user authorizes in their browser (client-side) — Device Flow bridges that gap without requiring a redirect URI back to the agent. Same pattern used by GitHub CLI (`gh auth login`).

**`gitAgent/lib/github-auth.mjs`** — OAuth flow:
1. `beginGithubDeviceFlow()` POSTs to `github.com/login/device/code` → gets `device_code` + `user_code`
2. Explorer UI shows the user code + "Copy code and open GitHub" button (browser-side)
3. User opens `github.com/login/device` in their browser, enters the code, selects GitHub account
4. `pollGithubDeviceFlow()` polls `github.com/login/oauth/access_token` until the user approves
5. On success, fetches profile from `/user` and `/user/emails`
6. Token stored in **DPU agent's encrypted secret store** (not filesystem)

**Configuration:** `PLOINKY_GITHUB_CLIENT_ID` / `PLOINKY_GITHUB_CLIENT_SECRET` env vars (requires registering a GitHub OAuth App). Scopes: `repo`, `workflow`, `read:user`, `user:email`.

**Push/Pull:** Token injected via `git -c http.extraHeader=Authorization:Basic(x-access-token:<token>)`. SSH remotes explicitly rejected with error. `GIT_TERMINAL_PROMPT=0` prevents hangs.

**Commit Identity:** `git -c user.name=X -c user.email=Y commit` per-command. Can be pre-filled from GitHub profile after OAuth. Explorer UI remembers identity in `localStorage` via `getRememberedGitIdentity()`.

**Alternative:** Users can bypass OAuth entirely by pasting a PAT via `git_auth_store_token` tool.

### Comparison: WebStorm vs gitAgent

| Aspect | WebStorm | gitAgent |
|--------|----------|----------|
| **OAuth Flow** | Authorization Code (browser redirect to JetBrains callback) | Device Flow (user authorizes in browser, agent polls for token) |
| **OAuth App** | Pre-registered by JetBrains | Workspace-configured via env vars |
| **Token Storage** | IDE credential store | DPU encrypted secret store |
| **Push/Pull Auth** | Built-in credential helper | `git -c http.extraHeader=...` |
| **Commit Identity** | `git config` only (no GitHub profile) | Per-command `-c` injection; can pre-fill from GitHub profile |
| **SSH Support** | Full SSH agent delegation | HTTPS only (SSH explicitly rejected) |
| **Scopes** | `repo`, `gist`, `read:org` | `repo`, `workflow`, `read:user`, `user:email` |

### How Ploinky Already Passes User Identity

**`ploinky/cli/server/mcp-proxy/index.js:104-168`** — the MCP proxy injects auth metadata on every request:

```javascript
const authMeta = {
  user: {
    id: req.user.id,
    username: req.user.username || req.user.name || req.user.email,
    email: req.user.email,
    roles: req.user.roles
  },
  sessionId: req.sessionId
};
// Injected via header AND tool arguments:
headers['x-ploinky-auth-info'] = encode(authMeta);
args._meta = { auth: authMeta };
```

The authenticated user object comes from PWD auth (manifest.json users) or Keycloak SSO.

### What's Missing

The Explorer's `assistOS.user` object uses a hardcoded email:

**`explorer/services/assistosSDK.js:454`:**
```javascript
user: { email: DEFAULT_EMAIL }  // hardcoded 'local@example.com'
```

This needs to be populated from the Ploinky auth context instead.

### Implementation Options

**Option A — Per-Commit Identity (recommended, minimal change):**

In Explorer code that calls `git_commit`, pass the logged-in user's identity:
```javascript
await callAgentTool('gitAgent', 'git_commit', {
  path: repoPath,
  message: commitMessage,
  userName:  assistOS.user.name,
  userEmail: assistOS.user.email
});
```

Requires: populate `assistOS.user` from Ploinky auth metadata instead of hardcoded default.

**Option B — Persistent Identity:**

Call `git_set_identity` once per session/repo, then all subsequent commits inherit that identity:
```javascript
await callAgentTool('gitAgent', 'git_set_identity', {
  path: repoPath, scope: 'local',
  name: assistOS.user.name, email: assistOS.user.email
});
```

### Architecture Notes

- `"gitAssistant/gitAgent global"` means the agent runs at WORKSPACE_ROOT as a single shared instance across all Explorer users
- The gitAgent also reads `x-ploinky-auth-info` header for GitHub token management (push/pull auth), via `extractAuthInfo()` in `tools/git_tool.mjs:59-63`
- Since the agent is global, user identity MUST be passed per-operation (not set once globally) — Option A is the correct approach

### Summary

| Component | Status | Change Needed |
|-----------|--------|---------------|
| gitAgent `git_commit` tool | Has `userName`/`userEmail` params | None |
| gitAgent `git_set_identity` tool | Exists | None |
| Ploinky MCP proxy | Injects auth metadata | None |
| Explorer `assistOS.user` | Hardcoded email | Populate from Ploinky auth |
| Explorer git commit calls | Doesn't pass identity | Add `userName`/`userEmail` args |

**Effort: ~1-2 hours.** The infrastructure is 95% in place.

---

## 2. DPU Agent — Full Code Review

### Overview

The DPU Agent (Data Processing Unit) provides a **confidential data plane** for AssistOS Explorer: encrypted secret storage, confidential file/folder management, role-based ACLs, and identity resolution through a permissions manifest. It runs as a standalone HTTP MCP server.

### File Structure

| File | Purpose |
|------|---------|
| `server/standalone-mcp-server.mjs` (294 lines) | HTTP server, session management, tool dispatch |
| `lib/dpu-store.mjs` (954 lines) | Domain logic: secrets, confidential objects, comments, ACLs |
| `lib/dpu-store-internal/storage.mjs` (~320 lines) | File I/O, AES-256-GCM encryption, directory-based locking |
| `lib/dpu-store-internal/identity-acl.mjs` | Role hierarchy, permission checking, comment serialization |
| `lib/dpu-store-internal/permissions-manifest.mjs` | Principal registry, ACL normalization, identity alias resolution |
| `lib/dpu-store-internal/common.mjs` | Validation helpers, normalization, timestamps |
| `tools/dpu_tool.mjs` (237 lines) | CLI tool wrapper, input validation, auth envelope extraction |
| `tools/dpu_tool.sh` | Bash wrapper invoking dpu_tool.mjs |
| `manifest.json` | Ploinky deployment config |
| `mcp-config.json` (365 lines) | 25 MCP tool definitions |

### MCP Tools (25 total)

| Category | Tools |
|----------|-------|
| Identity (2) | `dpu_whoami`, `dpu_workspace_roots` |
| Secrets (6) | `dpu_secret_list`, `dpu_secret_get`, `dpu_secret_put`, `dpu_secret_delete`, `dpu_secret_grant`, `dpu_secret_revoke` |
| Confidential Objects (6) | `dpu_confidential_list`, `dpu_confidential_get`, `dpu_confidential_create`, `dpu_confidential_update`, `dpu_confidential_delete`, `dpu_confidential_grant` |
| Comments (2) | `dpu_confidential_comment_add`, `dpu_confidential_comment_delete` |
| Permissions (1) | `dpu_access_check` |
| ACL management (8) | Revoke tools, additional grant operations |

### Encryption Architecture

**Confidential Files** — AES-256-GCM with per-write random IV:
```javascript
// Master key derived: SHA256("dpu:confidential:" + DPU_MASTER_KEY)
// Format on disk: DPUENC1:{iv}:{authTag}:{ciphertext}  (all base64)
```

**Secrets Map** — entire map encrypted as one blob:
```javascript
// Master key derived: SHA256("dpu:secret-map:" + DPU_MASTER_KEY)
// Format on disk: DPUSECS1:{iv}:{authTag}:{ciphertext}
```

**Key properties:**
- NIST-recommended AEAD cipher (AES-256-GCM)
- Random 12-byte IV per write (no reuse)
- Auth tag validates integrity
- Plaintext storage explicitly rejected

### Permission Model

**Secrets:** `access` < `read` < `write`
- `access`: reference the secret (e.g., inject into env) without seeing its value
- `read`: see the decrypted value
- `write`: modify value and manage ACL

**Confidential Objects:** `access` < `read` < `comment` < `write`
- `access`: see metadata (name, type) without content
- `read`: open and read file content
- `comment`: add annotations
- `write`: edit, rename, delete, create children, manage ACL

Permissions inherit from parent folders (ancestor chain checked).

### Identity Resolution

**`identity-acl.mjs:99-129`** — `resolveActor()`:
1. Extract identity hints from auth envelope (Ploinky's `x-ploinky-auth-info` header)
2. Resolve canonical principal ID from permissions manifest aliases
3. Priority: manifest entry → email → `user:{id}` → `user:{username}` → `sso:{subject}`
4. Email normalized to lowercase for matching

**`permissions-manifest.mjs:331-357`** — `resolvePrincipalFromManifest()`:
- Checks email aliases, user IDs, usernames, SSO subjects (with issuer validation)
- Returns canonical `principalId`

### Storage Layout

```
{dataRoot}/
├── .lock/                          # Directory-based mutex
├── state.json                      # Users, secrets metadata, object tree
├── permissions.manifest.json       # Principal aliases, ACL maps
├── secrets.json                    # Encrypted secrets blob
└── blobs/
    └── {objectId}                  # Encrypted file content
```

**Locking:** `withFileLock()` retries mkdir for up to 8 seconds. All mutations go through `withLockedState()`.

### Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DPU_MASTER_KEY` | Yes | Master encryption key; no fallback — hard error if missing |
| `DPU_DATA_ROOT` | No | Defaults to `../.dpu-storage` relative to workspace |
| `DPU_WORKSPACE_ROOT` | No | Falls back to `ASSISTOS_FS_ROOT` → `WORKSPACE_ROOT` → `cwd` |

### HTTP Endpoints

- `POST /mcp` — MCP JSON-RPC dispatch (session management via `mcp-session-id` header)
- `GET /health` — `{ "ok": true, "server": "dpu-agent" }`

### Explorer Integration

**`explorer/web-components/pages/file-exp/file-exp-dpu-provider.js`** — maps virtual paths:
```
/Confidential/
├── My Space/              (user's private folder tree)
├── Shared with me/        (objects shared by others)
└── Secrets/               (flat list of secrets by key)
```

Explorer caches workspace roots and node metadata. Calls DPU tools via `callAgentTool('dpuAgent', toolName, args)`.

**UI Plugins:**
- `dpu-runtime-support`: lifecycle hook stubs
- `dpu-permissions-modal`: ACL grant/revoke UI with principal picker

### Issues & Improvement Areas

| # | Severity | Finding |
|---|----------|---------|
| 1 | Medium | **Subprocess per tool call**: Every invocation spawns `dpu_tool.mjs` → load modules → parse stdin → execute → exit. Non-trivial latency. Consider inlining tool logic into the MCP server. |
| 2 | Medium | **No rate limits or quotas**: Unbounded secrets, objects, file sizes, comments per actor. Potential storage DoS. |
| 3 | Medium | **Lock timeout fixed at 8s**: Not configurable. Could fail on slow storage or high contention. Make configurable via env var. |
| 4 | Low | **No principal alias deduplication**: If multiple principals have the same email alias (data corruption), first match wins silently. Add uniqueness validation. |
| 5 | Low | **Comment normalization not called on read**: `normalizeCommentRecords()` runs on write but not in `serializeConfidentialObject()`. Corrupted comments may serialize with missing IDs. |
| 6 | Low | **No cascade-delete blob validation**: If a blob file is missing, metadata deletion succeeds silently. Should log warnings. |
| 7 | Low | **No audit trail**: Tool responses don't include which principal executed the operation. Would help debugging and compliance. |
| 8 | Info | **No master key rotation support**: Key derivation uses fixed namespace, no versioning. Would need re-encryption of all data to rotate. |
| 9 | Info | **Hardcoded auth header name** (`x-ploinky-auth-info`): If header name changes in Ploinky, auth fails silently. |

### Security Strengths

- AES-256-GCM with per-write random IVs
- Plaintext storage explicitly rejected
- Actor-aware ACL (not role-based — principal-centric)
- Hierarchical role permissions with ancestor inheritance
- Secret values never stored unencrypted on disk

### Test Coverage

**`tests/dpu-store.test.mjs`** — 6 test cases covering:
- Encryption at rest (confidential files, secrets)
- Plaintext rejection
- Actor principal resolution
- ACL canonical principal storage
- Permissions manifest as ACL source of truth

**Not covered:** concurrent access, quotas, comment edge cases, HTTP stress testing.

---

## 3. Secrets Management — Derived Master Feasibility

### Current Secrets Inventory

| Secret | Used By | Source |
|--------|---------|--------|
| `SOUL_GATEWAY_API_KEY` | Explorer, gitAgent, soplangAgent, llmAssistant | `~/work/.env` → `.ploinky/.secrets` |
| `ONLYOFFICE_JWT_SECRET` | Explorer (OnlyOffice document editor) | Derived from `PLOINKY_DERIVED_MASTER_KEY` via manifest `derive: "derived-master"` |
| `DPU_MASTER_KEY` | dpuAgent | Derived from `PLOINKY_DERIVED_MASTER_KEY` via `{{generatedSecret:DPU_MASTER_KEY}}` |
| `PLOINKY_GITHUB_CLIENT_ID/SECRET` | gitAgent (GitHub OAuth) | `.ploinky/.secrets` |
| `ASSISTOS_FS_ROOT` | All agents | Not a secret — filesystem path |

**Key insight:** Agents use Soul Gateway for LLM calls. Individual provider API keys are obsolete for this deployment and should not be stored as GitHub Actions secrets or workspace variables.

### Current Storage & Distribution Flow

```
~/work/.env                      ← User-managed secrets
       ↓
preinstall.sh (resolve_config_var)
       ↓
.ploinky/.secrets                ← Workspace-scoped secret store
       ↓
agentServiceManager.js (buildEnvFlags)
       ↓
Container -e flags               ← Agent receives secrets as env vars
       ↓
process.env                      ← Agent runtime access
```

**Resolution priority** (`secretInjector.js:111-126`):
1. `process.env` (host environment)
2. `.ploinky/.secrets` (workspace file)
3. `.env` file (walked up from cwd)

**Derived agent-owned secrets**:
- Ploinky injects `PLOINKY_DERIVED_MASTER_KEY`, derived from `PLOINKY_MASTER_KEY`.
- Per-agent workspace-owned secrets use manifest `generatedSecret: true` or `{{generatedSecret:...}}`.
- Legacy cross-agent shared credentials may still use explicit `derive: "derived-master"` entries or `{{derivedMasterSecret:...}}` templates when they must pin a logical repo, agent, or secret name different from the current agent.
- `DPU_MASTER_KEY` and `ONLYOFFICE_JWT_SECRET` are derived values, not random `.secrets` entries.

### The Derivation Pattern Already Exists

**`dpuAgent/lib/dpu-store-internal/storage.mjs:68-86`:**
```javascript
function deriveMasterKey(namespace) {
  return createHash('sha256')
    .update(`${namespace}${configured_key}`, 'utf8')
    .digest();
}

// Produces separate keys:
getConfidentialMasterKey()  // SHA256("dpu:confidential:" + DPU_MASTER_KEY)
getSecretMapMasterKey()     // SHA256("dpu:secret-map:" + DPU_MASTER_KEY)
```

This pattern is now centralized in Ploinky with HKDF-SHA256 and domain-separated labels instead of ad hoc SHA-256 concatenation.

### Current 2-Secret Architecture

**`~/work/.env`:**
```bash
SOUL_GATEWAY_API_KEY=sk-soul-...   # API access to soul-gateway
PLOINKY_MASTER_KEY=<64-char-hex>   # Derives PLOINKY_DERIVED_MASTER_KEY and workspace subkeys
```

**Derivation scheme:**
```bash
PLOINKY_DERIVED_MASTER_KEY = HKDF(PLOINKY_MASTER_KEY, "ploinky/derived-master/v1")
ONLYOFFICE_JWT_SECRET      = HKDF(PLOINKY_DERIVED_MASTER_KEY, "ploinky/agent-secret/AssistOSExplorer/explorer/ONLYOFFICE_JWT_SECRET/v1")
DPU_MASTER_KEY             = HKDF(PLOINKY_DERIVED_MASTER_KEY, "ploinky/agent-secret/AssistOSExplorer/dpuAgent/DPU_MASTER_KEY/v1")
```

### Feasibility Assessment

**Implemented in Ploinky.** The codebase now has:
1. The derivation pattern (DPU storage.mjs)
2. The secret injection pipeline (secretInjector.js → agentServiceManager.js)
3. Host lifecycle hook env resolution for manifest-derived values
4. Manifest support for `generatedSecret: true`, `{{generatedSecret:...}}`, and legacy explicit shared derivations through `derive: "derived-master"` or `{{derivedMasterSecret:...}}`

### Risks & Trade-offs

| Risk | Severity | Mitigation |
|------|----------|------------|
| Single point of compromise (`PLOINKY_MASTER_KEY` → all derived secrets) | High | Accept for single-deployment; for multi-tenant, add deployment-specific namespace component |
| No key rotation support | Medium | Re-derive all secrets on master-key change; DPU data would need re-encryption |
| Breaking change for existing deployments | Medium | Migrate stored data under stable derivation labels; do not reintroduce explicit overrides for workspace-owned agent secrets |
| OnlyOffice container needs JWT at startup time | Low | Already solved — preinstall.sh runs before container creation |
| Multiple workspaces share derived secrets | Low | Add workspace path hash to namespace if isolation needed |

### Effort Estimate

- Minimal viable: preinstall.sh + agentServiceManager.js changes (~3-4 hours)
- Production-grade with migration: ~2-3 days

---

## Appendix: Agent Manifest Dependencies

### Agents enabled by Explorer

```json
"enable": [
    "gitAgent global",
    "dpuAgent global",
    "soplangAgent global",
    "tasksAgent global",
    "llmAssistant global",
    "multimedia global",
    "webassist/webCli global"
]
```

`global` = runs at WORKSPACE_ROOT as a single shared instance across all Explorer users.

### Per-Agent Environment Requirements

| Agent | Required Env Vars | Secrets |
|-------|-------------------|---------|
| Explorer | ASSISTOS_FS_ROOT, SOUL_GATEWAY_API_KEY | ONLYOFFICE_JWT_SECRET (optional) |
| gitAgent | ASSISTOS_FS_ROOT | SOUL_GATEWAY_API_KEY |
| dpuAgent | ASSISTOS_FS_ROOT, DPU_MASTER_KEY | DPU_MASTER_KEY |
| soplangAgent | SOUL_GATEWAY_API_KEY | — |
| tasksAgent | ASSISTOS_FS_ROOT | — |
| llmAssistant | ASSISTOS_FS_ROOT | SOUL_GATEWAY_API_KEY |
