# OnlyOfficeAgent — Decorator Architecture & Security Design

| Field | Value |
| --- | --- |
| Status | **Proposed / Draft** (not yet implemented) |
| Scope | Evolution of the `onlyOffice` agent into an **OnlyOfficeAgent decorator** that fronts the standard OnlyOffice Document Server and owns persistence routing (filesystem vs. encrypted DPU) using **B2 router-minted user delegation** for DPU. |
| Owning agent | `agent:AssistOSExplorer/onlyOffice` (route key `onlyOffice`) |
| Related agents | `agent:AssistOSExplorer/explorer`, same-repo `dpuAgent` (`agent:./dpuAgent` in the manifest, expanded by Ploinky to `agent:<repo>/dpuAgent`) |
| Authoritative security base | `ploinky/docs/specs/DS011-security-model.md`, DS013 (per-agent secrets), DS014 (MCP policy) |

> This is a **design document**, not an implemented DS spec. When this architecture is built, promote the relevant sections into the `onlyOffice` and `explorer` DS sets and resynchronize docs via the `gamp-specs` skill.
>
> Implementation sequencing and the proposed test suite live in [`onlyofficeagent-b2-implementation-plan.md`](./onlyofficeagent-b2-implementation-plan.md).

---

## 1. Executive summary

In the current workspace, Office editing is split across two agents in a way that exposes more public surface than necessary:

| Concern | Current owner | Observed evidence |
| --- | --- | --- |
| Document Server runtime (image, JWT, ports, storage) | `onlyOffice` agent (thin wrapper over `onlyoffice/documentserver`) | `onlyOffice/manifest.json:1-13`, `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md:13-22` |
| Office **session / config / document / callback** routes | **Explorer** | `explorer/manifest.json:61-73`, `explorer/utils/server/onlyoffice/onlyoffice-http-routes.mjs:170-182` |
| Persistence routing (workspace fs vs. DPU) | **Explorer** | `explorer/utils/server/onlyoffice/onlyoffice-document-store.mjs:111-169` |
| Encrypted-at-rest confidential storage | `dpuAgent` | `dpuAgent/lib/dpu-store-internal/storage.mjs:82-101,326-336` |

The chosen architecture makes **OnlyOfficeAgent** a *decorator* that wraps the standard Document Server image and owns the session/config/document/callback/persistence-routing logic. The browser's Office editor then talks **only to OnlyOfficeAgent**.

For Confidential files, this design chooses **B2: router-minted user delegation**. OnlyOfficeAgent may call dpuAgent only by presenting both its own Agent Assertion and a router-issued user-delegation grant minted from the protected Office session route. The router verifies both, applies MCP policy, and mints the DPU-audience Router Request with the original user in router-signed `usr` claims. DPU therefore evaluates ACLs for the user, while audit data can still record that OnlyOfficeAgent performed the delegated Office operation.

The single most important security property: **the document-download and save-callback routes are not public**. In the legacy Explorer-owned design they were anonymous (`/public-services/explorer/office/...`, equivalent to `access: "public"`) because the Document Server lived in a separate container and had to reach Explorer across the network (`explorer/manifest.json:68-73`, DS04:106-114). When the decorator and the Document Server are **co-located in one agent**, that traffic is **localhost-only** between the Document Server and the decorator, and never needs internet or router exposure.

The design classifies every endpoint into the three exposure tiers from the brief:

| Tier | Practice rating | What belongs here |
| --- | --- | --- |
| **1 — Localhost / agent-internal** | preferred | Document Server ↔ decorator document & callback traffic; DPU delegation (Agent Assertion + router-minted user-delegation grant → router-mediated MCP). |
| **2 — Public / browser-direct** | *necessary evil*, must be minimized + hardened | OnlyOffice editor assets (`api.js`, SDK, fonts) and the co-editing WebSocket only. |
| **3 — Router-proxied, authenticated** | preferred | The "open Office session / build config" control endpoint, called by Explorer/the browser with a Ploinky session. |

---

## 2. Current architecture (as-is) — Observed

### 2.1 Component & flow

```text
Browser (Explorer SPA)
  │  1. GET /services/explorer/office/session?path=...        (access: authenticated)
  ▼
Ploinky Router ──────────────────────────────► Explorer agent
  │  injects x-ploinky-auth-info (+ invocation token)   │  builds + HS256-signs editor config
  │                                                      │  mints opaque 30-min session token
  │  2. returns { config, documentServerUrl=PUBLIC_URL } │
  ▼                                                      │
Browser loads {PUBLIC_URL}/web-apps/apps/api/documents/api.js   ── from onlyOffice agent (DS)
  │  new DocsAPI.DocEditor(container, config)
  ▼
OnlyOffice Document Server  (onlyOffice agent, 127.0.0.1:8082 → tunnel → office.axiologic.dev)
  │  3. GET  /public-services/explorer/office/document/<token>   (legacy access: public)  ─► Explorer
  │  4. POST /public-services/explorer/office/callback/<token>   (legacy access: public)  ─► Explorer
  ▼                                                                                  │
Explorer storage bridge                                                              │
  ├─ workspace path → fs.readFile / fs.writeFile  ────────────────────────► local disk
  └─ /Confidential/... → router MCP → dpuAgent (dpu_confidential_get/update) ─► encrypted blob
```

Evidence: `explorer/utils/server/onlyoffice/onlyoffice-http-routes.mjs:56-182`, `onlyoffice-config.mjs:62-117`, `onlyoffice-document-store.mjs:111-169`, `onlyoffice-dpu-client.mjs:40-91`.

### 2.2 Strong properties of the current model

| Property | Evidence |
| --- | --- |
| Session creation is **authenticated** (`access: "authenticated"`, requires `x-ploinky-auth-info`) | `onlyoffice-http-routes.mjs:56-61`; `explorer/manifest.json:63-66` |
| Confidential persistence is **router-mediated MCP**, never a direct container dial | `onlyoffice-dpu-client.mjs:40-91`; DS04:160-164 |
| Editor config is **HS256-signed**, so the browser cannot tamper with `document.url`/permissions | `onlyoffice-config.mjs:93-97` (`token: signJwt(baseConfig, settings.jwtSecret)`) |
| Document Server's `JWT_SECRET` == Explorer's `ONLYOFFICE_JWT_SECRET` via `sharedGeneratedSecret` | `onlyOffice/manifest.json:28-33`; `explorer/manifest.json:112-116` |
| Confidential bytes are **AES-256-GCM at rest** in dpuAgent | `dpuAgent/lib/dpu-store-internal/storage.mjs:326-336` |

### 2.3 Weaknesses the new design removes

| Weakness | Evidence | Consequence |
| --- | --- | --- |
| document & callback routes are **anonymous and internet-reachable** | legacy Explorer-owned `/public-services/explorer/office/...` routes (`access: "public"`) | A leaked/guessed session token is usable by anyone on the internet; the only gate is an opaque token with a 30-min TTL. |
| Explorer (the IDE shell) carries Office server-bridge responsibilities | `onlyoffice-http-routes.mjs`, `onlyoffice-document-store.mjs` | Office networking concerns are entangled with the IDE; two agents must agree on URL/JWT wiring. |

### 2.4 Current onlyOffice agent — exposed ports & endpoints

The current `onlyOffice` agent overrides the runtime entrypoint to run the Document Server image directly (`entrypoint: "/bin/bash"`, `start: "/app/ds/run-document-server.sh"`; `onlyOffice/manifest.json:3-4`). It therefore does **not** run the bundled AgentServer and declares **no Ploinky `httpServices`, no MCP tools, and no `/mcp` surface**. The only thing it exposes is the Document Server's own HTTP/WebSocket port. The Office session/document/callback routes are owned by Explorer, not by this agent.

**Published ports** (host:container; the container listens on port `80`):

| Profile | Host publish (manifest) | Bind | Internet reachability |
| --- | --- | --- | --- |
| `default` | `127.0.0.1:8082:80` | localhost only | via tunnel/reverse proxy (`ONLYOFFICE_PUBLIC_URL`, e.g. `office.axiologic.dev`) |
| `prod` | `127.0.0.1:8082:80` | localhost only | same as `default` |
| `dev` | `127.0.0.1:18082:80` | localhost only | local-dev only |

Evidence: `onlyOffice/manifest.json:35,57,79`; `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md:18`. Readiness is **TCP** on the published host port (`manifest.json:6-8`); TCP-open is the startup gate, not proof that `api.js` has warmed (DS01:20).

**Endpoint surface** (served by the Document Server image on container `:80`):

| Endpoint | Purpose | Source |
| --- | --- | --- |
| `GET /web-apps/apps/api/documents/api.js` | editor bootstrap the browser loads — the one contract endpoint Explorer depends on | **Observed**: `explorer/services/onlyoffice/onlyoffice-editor-host.js:28` |
| `GET /web-apps/*`, `/sdkjs/*`, `/fonts/*`, `/cache/files/*` | editor SPA assets | OnlyOffice product reference |
| `WS /doc/<key>/c/*` | co-editing WebSocket channel | OnlyOffice product reference |
| `POST /coauthoring/CommandService.ashx`, `/ConvertService.ashx` | command / format conversion (server-to-server) | OnlyOffice product reference |
| `GET /healthcheck` | liveness | OnlyOffice product reference |

> Today this entire surface is published to `127.0.0.1:8082` and exposed to the internet via the tunnel, with OnlyOffice's own JWT (`JWT_ENABLED=true`, `manifest.json:24-33`) as the only application-level gate. The new design narrows what reaches the internet (§5) and moves storage traffic off the public surface (§3).

---

## 3. Target architecture (to-be) — Proposed

### 3.1 Component model

OnlyOfficeAgent is a single Ploinky agent that bundles two processes plus a thin control surface:

```text
                          INTERNET (reverse proxy / Cloudflare tunnel, dedicated host e.g. office.axiologic.dev)
                                   │  Tier 2: editor assets + co-editing WebSocket ONLY
                                   ▼
┌───────────────────────────── OnlyOfficeAgent (one Ploinky agent) ─────────────────────────────┐
│                                                                                                │
│   ┌─────────────────────────── Decorator (Node, AchillesAgentLib) ──────────────────────────┐ │
│   │  • Tier 3 control API:  build + sign Office session config (router-authenticated)         │ │
│   │  • Tier 1 storage API:  /document/<token>, /callback/<token>  (localhost only)            │ │
│   │  • Persistence router:  Confidential → dpuAgent (B2 delegated MCP) | workspace → disk      │ │
│   │  • Asset/WS reverse-proxy to the Document Server over 127.0.0.1                            │ │
│   └───────────────┬───────────────────────────────────────────────┬──────────────────────────┘ │
│                   │ 127.0.0.1 (intra-agent)                         │ 127.0.0.1 (intra-agent)      │
│                   ▼                                                 ▼                              │
│   ┌──────────── Standard OnlyOffice Document Server ───────────┐   (decorator reads/writes)       │
│   │  docker.io/onlyoffice/documentserver:${ONLYOFFICE_VERSION} │                                  │
│   │  api.js · editor SPA · sdkjs · fonts · /doc/<key>/c (WS)   │                                  │
│   │  /ConvertService.ashx · /coauthoring/CommandService.ashx  │                                  │
│   └────────────────────────────────────────────────────────────┘                                │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
        │ Tier 1: delegated MCP (Agent Assertion + User Delegation Grant → Router Request)
        ▼
Ploinky Router ─► dpuAgent  (Router Request carries usr claims; AES-256-GCM at rest)

Direct disk access (workspace volume, path-confined)  ◄─── decorator, for non-confidential files
```

### 3.2 Responsibility ownership

| Responsibility | Owner |
| --- | --- |
| Document Server lifecycle (image, ports, JWT, volumes, readiness) | OnlyOfficeAgent (Document Server base) |
| Build + sign Office editor config | OnlyOfficeAgent decorator |
| Session token store (opaque, TTL) | OnlyOfficeAgent decorator |
| document/callback HTTP routes (localhost) | OnlyOfficeAgent decorator |
| Persistence routing (Confidential vs workspace) | OnlyOfficeAgent decorator |
| Router-minted user delegation for Confidential DPU calls | Ploinky Router |
| Workspace path-confinement & `.secrets` exclusion | OnlyOfficeAgent decorator (see §8) |
| Encrypted-at-rest confidential storage | dpuAgent |
| Initiating "open this file in Office" | Explorer UI |

### 3.3 Request flow (to-be)

```text
1. User opens an Office file in Explorer.
2. Browser → Ploinky Router → OnlyOfficeAgent decorator:
      GET /services/onlyoffice/office/session?path=<workspace-or-/Confidential-path>
      (Tier 3, access: authenticated; router injects verified x-ploinky-auth-info + invocation token)
3. Decorator:
      - verifies the router invocation token (verifyHttpServiceAuthInfoFromHeaders)
      - extracts and stores the router-minted User Delegation Grant for the Office session
      - resolves the path: workspace (direct disk, path-confined) OR /Confidential (DPU metadata via delegated MCP)
      - determines permissions (workspace default-write; Confidential from DPU ACL canWrite/canComment)
      - mints an opaque session token (server-side, TTL)
      - builds the editor config with:
            document.url       = http://127.0.0.1:<storage-port>/internal/document/<token>   (loopback; NOT the route hostPort — see §9.1)
            editorConfig.callbackUrl = http://127.0.0.1:<storage-port>/internal/callback/<token> (loopback; NOT the route hostPort)
            documentServerUrl  = <PUBLIC editor base for the browser>
        and HS256-signs the config with ONLYOFFICE_JWT_SECRET
4. Browser loads {documentServerUrl}/web-apps/apps/api/documents/api.js  (Tier 2, public)
   Browser: new DocsAPI.DocEditor(container, config)
5. Document Server (intra-agent) reads document.url over 127.0.0.1 → decorator streams bytes (Tier 1)
6. Document Server (intra-agent) posts save callback over 127.0.0.1 → decorator (Tier 1)
7. Decorator persists:
      - workspace path → write to mounted disk (path-confined)
      - /Confidential/... → Router verifies Agent Assertion + User Delegation Grant → dpuAgent dpu_confidential_update (base64) → AES-256-GCM at rest (Tier 1)
```

The browser **does** receive the signed config — including the `document.url` and `callbackUrl` values — and passes it to `DocsAPI.DocEditor`, which forwards it to the Document Server. Those URLs point at a loopback storage port that is **not** the agent's router-facing `hostPort` and is **not** host-published (see §9.1), so only the co-located Document Server can reach them; the browser holds them but cannot use them over the network. The Document Server never reaches the public internet for storage. The only thing on the public internet is the editor runtime.

---

## 4. Persistence routing (the decorator's core decision)

The decorator chooses a backend per requested path, using the same predicate that classifies confidential paths today (`isDpuVirtualPath`, i.e. path equals or descends from `/Confidential`; `explorer/services/dpu/dpuPaths.js:1-25`):

| Path class | Backend | At-rest protection | How |
| --- | --- | --- | --- |
| `/Confidential/My Space/…`, `/Confidential/Shared/…` | **dpuAgent** | **AES-256-GCM encrypted** (`DPUENC1` blob) | B2 delegated router MCP: OnlyOfficeAgent Agent Assertion + router User Delegation Grant → DPU Router Request with `usr` claims |
| `/Confidential/Secrets/…` | **rejected** | n/a | secrets are excluded from OnlyOffice (`onlyoffice-document-store.mjs:71-73`) |
| Any other workspace path | **direct disk** | filesystem-level only | `fs.readFile` / `fs.writeFile` within the mounted, path-confined workspace |

Encryption-at-rest detail for the Confidential path (owned by dpuAgent):

| Aspect | Value | Evidence |
| --- | --- | --- |
| Cipher | AES-256-GCM, random 12-byte IV, stored auth tag | `dpuAgent/lib/dpu-store-internal/storage.mjs:326-336` |
| Key derivation | `SHA256("dpu:confidential:" + DPU_MASTER_KEY)` | `storage.mjs:24,82-101` |
| Master key | per-agent `{{generatedSecret:DPU_MASTER_KEY}}`; **never** the Ploinky master key | `dpuAgent/manifest.json:13`; DS08 invariant |
| Blob layout | one file per object id under `<DPU_DATA_ROOT>/blobs/<uuid>` | `storage.mjs:66-76` |

> Design note: this is the diagram's "Fisier office in DPU-Agent → criptat on rest" vs. "Fisier office intr-un folder normal" split. The decorator makes the choice; dpuAgent provides the encryption.

---

## 5. Endpoint exposure classification

This section is the heart of the brief: which OnlyOffice endpoints go to the internet, which stay internal, and how each is authenticated.

### 5.1 Tier 2 — Public / internet-exposed (minimize and harden)

Only the OnlyOffice **editor runtime** must be reachable by the browser. These are served by the standard Document Server image; the decorator (or the reverse proxy) forwards them.

| Endpoint (Document Server) | Why public | Verified |
| --- | --- | --- |
| `GET /web-apps/apps/api/documents/api.js` | bootstraps `DocsAPI.DocEditor` in the browser | **Observed**: `explorer/services/onlyoffice/onlyoffice-editor-host.js:28` |
| `GET /web-apps/*`, `/sdkjs/*`, `/sdkjs-plugins/*`, `/fonts/*`, `/themes/*` | editor SPA assets the browser loads | OnlyOffice product reference (verify against pinned `9.3.1`) |
| `GET /cache/files/*` | rendered/cached document chunks the editor fetches | OnlyOffice product reference |

> **Defense-in-depth note:** the proxy now blocks bare-directory requests (`/cache/files/` and `/cache/files`) and only forwards paths with a non-empty sub-path (`/cache/files/<key>/...`). Enumeration protection ultimately depends on the Document Server image running nginx with `autoindex off` for `/cache/files/`.
| `WS /doc/<key>/c/*` (and the upgrade path) | co-editing WebSocket channel | OnlyOffice product reference |

**Rules for Tier 2:**

| Rule | Rationale |
| --- | --- |
| Expose under a **dedicated host** (e.g. `office.axiologic.dev`), not the Explorer/router host | the editor surface carries **no Ploinky identity**; isolate it |
| Keep OnlyOffice's own JWT **enabled** (`JWT_ENABLED=true`, shared `ONLYOFFICE_JWT_SECRET`) | the Document Server validates the signed config, so the browser cannot forge `document.url`/permissions (`onlyOffice/manifest.json:24-33`) |
| **Block** Document Server internal/admin/demo endpoints from the internet (see §5.4) | they are not needed by the browser and widen attack surface |
| Terminate TLS at the proxy; apply rate limiting / DDoS controls at the edge | DS011:164 names these as required before internet exposure |

> Honesty note: routing the editor's broad asset tree **and** WebSocket through the Ploinky router's path-prefix proxy is awkward (the router proxies path-prefixed HTTP services; co-editing needs WebSocket upgrade). The realistic shape is a reverse proxy/tunnel in front of the Document Server port. This is the "*exposed publicly, called from the browser — not a good practice*" tier from the brief: it is **unavoidable for the editor runtime**, so we shrink it to assets+WS only and lean on OnlyOffice's config-JWT plus edge hardening.

### 5.2 Tier 3 — Router-proxied, authenticated (Explorer-/user-facing control plane)

The "open an Office session" operation is the only control endpoint the browser/Explorer needs, and it must be authenticated.

| Endpoint (decorator) | Exposure | Auth | Notes |
| --- | --- | --- | --- |
| `GET /services/onlyoffice/office/session?path=…` | Ploinky Router, `access: "authenticated"` | User Session JWT → router injects verified `x-ploinky-auth-info` + invocation token | builds & signs config; returns `documentServerUrl` + opaque token |

This is the brief's "*endpoints proxied by the Ploinky Router (authenticated) — good practice*" tier, and it is the endpoint that should be **available only to Explorer / authenticated users** (a guest or anonymous internet client must not be able to mint Office sessions for arbitrary paths).

Optional agent-to-agent variant (also "good practice"): expose session-open as an **MCP tool** (`office_open_session`) tagged `internal`, so an agent backend can open a session programmatically via Agent Assertion → Router Request. Use this only if a server-side caller needs it; the browser path above is primary.

### 5.3 Tier 1 — Localhost / agent-internal (no internet, no router)

| Endpoint / channel | Caller | Exposure |
| --- | --- | --- |
| `GET /internal/document/<token>` (decorator) | the **co-located Document Server** | dedicated loopback port — not the route `hostPort`, not host-published (§9.1) |
| `POST /internal/callback/<token>` (decorator) | the **co-located Document Server** | dedicated loopback port — not the route `hostPort`, not host-published (§9.1) |
| Document Server `/ConvertService.ashx`, `/coauthoring/CommandService.ashx` | the **decorator** (server-to-server) | `127.0.0.1` inside the agent only |
| `dpu_confidential_get` / `dpu_confidential_update` | the **decorator** → Ploinky Router → dpuAgent | B2 router-mediated MCP: Agent Assertion + User Delegation Grant; no direct DPU port |

This is the brief's "*endpoints exposed only on localhost, called from MCP tools by other agents*" tier. The decorator↔Document Server document/callback traffic is localhost — the central security property of this architecture.

### 5.4 Document Server endpoints that must NOT be public

| Endpoint (Document Server) | Reason to block from the internet |
| --- | --- |
| `/coauthoring/CommandService.ashx` | command/force-save/version control surface; server-to-server only |
| `/ConvertService.ashx` (and `/converter`) | format conversion; called by the integrator, not the browser |
| `/example/*`, `/welcome/*` | bundled demo/integration test pages; data-exfiltration & probing surface |
| `/info/*`, `/internal/*`, healthcheck/admin pages | version/diagnostic disclosure |

These should be reachable only over localhost (decorator → DS) or blocked at the proxy. (Endpoint names are OnlyOffice product reference for the `9.3.1` line; confirm against the pinned image during implementation.)

---

## 6. Authentication & authorization

Three trust planes, each mapped onto the correct Ploinky mechanism. The governing rule (DS011:24, security-invariants.md:5-9): **the Ploinky Router is the trust broker; agent ports are implementation details even on localhost.**

### 6.1 Plane A — Browser → decorator session route (Tier 3)

| Step | Mechanism | Evidence / invariant |
| --- | --- | --- |
| Browser presents `ploinky_jwt` session cookie | User Session JWT, `aud: ploinky-router`, terminates at router | DS011:62; security-invariants.md:47,53 |
| Router authenticates, strips client `x-ploinky-*` headers, re-injects authoritative identity | router regenerates `x-ploinky-auth-info` + scoped `__http_service__` invocation token | strip: `routerHandlers.js:216-232`; reinjection + invocation minting: DS011:88 |
| Decorator **verifies** the invocation token before trusting identity | `verifyHttpServiceAuthInfoFromHeaders()` (audience, method, signed path, tool, `rch`, replay) | DS011:88; DS06:29 — *caller-supplied identity headers must be rejected as authoritative* |

The decorator must treat `x-ploinky-auth-info` as authoritative **only** after the invocation token verifies. A bare auth-info header (e.g. a forged copy) must be rejected.

### 6.2 Plane B — Decorator → dpuAgent (Tier 1, Confidential persistence) — B2 selected

The decorator must read/write Confidential documents in dpuAgent **as the acting user**, so DPU's per-user ACLs apply. A plain Agent Assertion is insufficient: `dpu_confidential_*` tools are currently `authenticated`, not `internal`, and a normal agent-to-agent call is minted with `actor.kind:"agent"`, which DPU would resolve as the agent rather than the user (`AssistOSExplorer/dpuAgent/mcp-config.json:447-525`; `ploinky/cli/server/policy/McpToolPolicy.js:138-141`; `ploinky/cli/server/mcp-proxy/index.js:120-128`; `ploinky/Agent/lib/invocation-auth.mjs:45-47`).

This design therefore chooses **B2: router-minted user delegation**. The router, not OnlyOfficeAgent, carries the verified user across the re-entrant agent call.

| Step | Required behavior |
| --- | --- |
| 1. Protected Office session route | Browser calls `/services/onlyoffice/office/session`; router authenticates the user, strips caller-supplied `x-ploinky-*`, and injects `x-ploinky-auth-info` with the normal `__http_service__` invocation token. |
| 2. Delegation grant minting | Because the OnlyOffice manifest explicitly declares a DPU delegation set for this protected service route, the router mints a **User Delegation Grant** only when the session request's `path` query parameter is boundary-contained by `/Confidential`. The grant is router-signed, audience `ploinky-router`, source-bound to `agent:<repo>/onlyOffice`, and limited to the same repo's `dpuAgent` + named Confidential tools/scopes for the Office editing window. |
| 3. Session binding | OnlyOfficeAgent verifies the HTTP-service invocation token before trusting `authInfo.user` or storing the delegation grant. The grant is stored only inside the opaque Office session record, never returned separately to the browser or logged. |
| 4. DPU call | For DPU operations, OnlyOfficeAgent signs its normal Agent Assertion and sends it to `/<dpuAgent>/mcp` together with the User Delegation Grant. The router verifies both tokens, verifies the grant allows this source/target/tool, applies MCP policy, and only then mints the DPU Router Request. |
| 5. DPU execution | The DPU-audience Router Request carries `caller: agent:AssistOSExplorer/onlyOffice`, `actor.kind:"agent"`, and router-signed `usr` claims for the original user. DPU's existing `authInfoFromInvocation()` gives `usr` precedence for ACLs while preserving the caller agent for audit. |

The grant is a delegation lease, not a raw user session token. It must not contain the browser cookie, must not be accepted directly by dpuAgent, and must not let the source agent change the user. The router must deny delegation when the Office service route is anonymous, when the authenticated actor is a guest, when the source agent does not match the manifest-declared source, when the target/tool is outside the grant, when the grant expired, or when MCP policy denies the delegated call.

Operational bound: the Office session's absolute lifetime must not exceed the delegation grant lifetime. Existing idle extension is acceptable only up to an absolute `delegationExpiresAt`; after that, document reads/saves fail closed and the user must reopen the editor to obtain a fresh user delegation.

### 6.3 Plane C — Browser editor ↔ Document Server (Tier 2)

| Control | Mechanism | Evidence |
| --- | --- | --- |
| Config integrity | OnlyOffice's own HS256 JWT over the editor config (`JWT_ENABLED=true`, `ONLYOFFICE_JWT_SECRET`) | `onlyoffice-config.mjs:93-97`; `onlyOffice/manifest.json:24-33` |
| Document access scoping | `document.url`/`callbackUrl` point to **localhost** decorator routes gated by an opaque session token | §3.3; `onlyoffice-session-store.mjs` (TTL) |
| Edge hardening | TLS, rate limiting, DDoS controls at the reverse proxy/tunnel | DS011:164 |

This plane is **not** a Ploinky-authenticated plane. Its safety rests on: (a) the browser cannot forge a config (JWT secret is server-only), (b) the data path the config references is localhost + token-scoped, and (c) edge hardening.

---

## 7. Authentication summary table

| From → To | Plane | Carrier | Verified by |
| --- | --- | --- | --- |
| Browser → decorator `/services/onlyoffice/office/session` | A (Tier 3) | `ploinky_jwt` cookie → router → `x-ploinky-auth-info` + invocation token | decorator (`verifyHttpServiceAuthInfoFromHeaders`) |
| Confidential persistence → dpuAgent | B (Tier 1) | Agent Assertion + router-minted User Delegation Grant → DPU Router Request with `usr` claims | router verifies source/grant/policy; dpuAgent resolves the **user** ACL and records the caller agent |
| Document Server → decorator (document/callback) | Tier 1 | opaque session token over `127.0.0.1` | decorator session store (TTL) |
| Browser editor ↔ Document Server (assets/WS) | C (Tier 2) | OnlyOffice config-JWT (`ONLYOFFICE_JWT_SECRET`) | Document Server |

---

## 8. Security invariants OnlyOfficeAgent MUST uphold

Derived from `ploinky/docs/specs/DS011-security-model.md`, the manage-ploinky-agents `security-invariants.md`, and the existing Explorer guards.

| # | Invariant | Source |
| --- | --- | --- |
| I1 | The router is the only public control point for authenticated/agent traffic; the decorator's Tier-3 and Tier-1 surfaces are **never** dialed directly by external clients. | DS011:24; security-invariants.md:5-9 |
| I2 | OnlyOfficeAgent receives only `PLOINKY_AGENT_ID` + its own `PLOINKY_AGENT_SECRET`; it must **never** receive `PLOINKY_MASTER_KEY`, `DPU_MASTER_KEY`, or another agent's secret. | DS011:26; DS013; security-invariants.md:19-34 |
| I3 | Agent-to-agent calls to dpuAgent go **through the router** (Agent Assertion + User Delegation Grant → Router Request); no direct container/port dialing. | DS011:98,106; DS013; security-invariants.md:156-160 |
| I4 | `x-ploinky-auth-info` is trusted only after the router invocation token verifies; caller-supplied identity headers are rejected. | DS06:29; DS011:88 |
| I5 | Direct-disk access is **path-confined**: reject `..` traversal, NUL bytes, symlink escape outside the workspace root, and the reserved `.secrets`/`*.secrets` files. Mirror Explorer's `resolvePathInAllowedRoots` / `isProtectedSecretPath`. | `filesystem-http-server.mjs:318-352`; DS011:126-134 |
| I6 | Workspace mount is declared as an explicit manifest volume/runtime resource under `.ploinky/`; least privilege (read-write only where editing requires). | DS011:112-114 |
| I7 | Document/callback routes are bound to localhost and accept requests only from the co-located Document Server; the opaque token is the gate, with a short TTL. | §3.3; `onlyoffice-session-store.mjs` |
| I8 | Confidential authorization stays in dpuAgent (ACL on the acting user); OnlyOfficeAgent must not assume a router session or delegation grant authorizes every DPU operation. | DS011:104 |
| I9 | Never log JWT secrets, document/callback tokens, `ONLYOFFICE_JWT_SECRET`, auth-info, or file contents. | `onlyOffice/CLAUDE.md:19`; DS011:146 |
| I10 | MCP tools (if any) are fail-closed and correctly tagged: `internal` for agent-only (e.g. `office_open_session`), never combining `internal`+`admin`. | DS014; security-invariants.md:162-172 |
| I11 | Keep the Document Server image pinned (`${ONLYOFFICE_VERSION}`, no `:latest`) and its internal Postgres/RabbitMQ/Redis dirs **not** bind-mounted in rootless Podman. | `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md:15,22` |

---

## 9. Manifest & configuration shape (proposed)

OnlyOfficeAgent keeps the Document Server base and adds a decorator runtime. Two viable runtime shapes:

| Option | Shape | Trade-off |
| --- | --- | --- |
| **A. Single agent, decorator as the agent process** | The agent's `agent`/`start` runs the decorator (Node), which also supervises/reverse-proxies the bundled Document Server over localhost. | Matches "browser talks only to OnlyOfficeAgent"; more wiring inside one container. |
| **B. Decorator sidecar in front of the DS image** | DS image runs as the base; decorator runs as a co-located process/port; proxy fronts the decorator. | Cleaner separation; requires both processes in one runtime unit. |

Recommended manifest intent (Option A/B share these declarations):

| Manifest field | Value | Purpose |
| --- | --- | --- |
| `httpServices[]` | `{ externalPrefix: "/services/onlyoffice/", internalPrefix: "/control/", access: "authenticated", delegations: [{ key: "dpuConfidential", targetAgentId: "agent:./dpuAgent", tools: ["dpu_workspace_roots", "dpu_confidential_list", "dpu_confidential_get", "dpu_confidential_update"], scopes: ["dpu:confidential:read", "dpu:confidential:write"], ttlSeconds: 28800, when: { queryParam: "path", pathRoots: ["/Confidential"] } }] }` — only `/control/*` is router-reachable; DPU delegation is explicit, portable, Confidential-path scoped, and fail-closed; route keys are routing labels, not identity | Tier 3 session route (router-authenticated) + B2 DPU delegation |
| ports | see §9.1 (DS editor surface fronted by the tunnel; control via router; document/callback never published) | exposure separation |
| `JWT_ENABLED` / `JWT_SECRET` | `true` / `varName: ONLYOFFICE_JWT_SECRET`, `sharedGeneratedSecret: true` | config integrity (shared only where the editor host needs to validate config JWTs) |
| workspace volume | explicit RW mount under workspace root | direct-disk persistence (I5/I6) |
| `ONLYOFFICE_VERSION` | pinned default (`9.3.1`) | I11 |

The design has **no** anonymous (internet-facing) Office route: document/callback are localhost-internal and carry no manifest `httpServices` declaration at all. There is no `access: "public"` office entry anywhere in the design.

### 9.1 Port & listener layout (proposed)

Logical listeners inside the OnlyOfficeAgent container and how each is reached. Port numbers are illustrative; exact wiring depends on the runtime shape (Option A/B above) and Ploinky's port publishing for custom runtimes. The **tier mapping** is the binding part.

| Listener | Container port | Host publish / routing | Tier — exposure | Serves |
| --- | --- | --- | --- | --- |
| Decorator — public editor surface | e.g. `8080` | `127.0.0.1:8082:8080` → tunnel (`ONLYOFFICE_PUBLIC_URL`) | **Tier 2** — internet (browser) | reverse-proxies the DS editor assets, `api.js`, and the co-editing WebSocket over `127.0.0.1`; nothing else public |
| Decorator — control API | e.g. `7000` | router host port from `.ploinky/routing.json`, `127.0.0.1` only (router-proxied; never on the tunnel) | **Tier 3** — Ploinky router, `access: authenticated` | `/control/office/session` (ext `/services/onlyoffice/office/session` → `/control/`) |
| Decorator — storage callbacks | dedicated loopback port, e.g. `9100` (or a Unix socket) — **distinct from the control/`hostPort`** | **not host-published, not the route `hostPort`** (container-internal `127.0.0.1` only) | **Tier 1** — co-located Document Server only | `/internal/document/<token>`, `/internal/callback/<token>` |
| OnlyOffice Document Server | `80` | **not host-published** when the decorator fronts it; reached only over `127.0.0.1` by the decorator | reached by the decorator only | DS runtime (assets, WS, convert/command) |

**Path-separation rule (security-critical):** an httpService prefix is **not** sufficient to keep `/internal/*` private. Besides the declared `/services/onlyoffice/` → `/control/` mapping, the router also does **generic agent passthrough**: `/<onlyOffice>/<anything>` is forwarded to the agent's route `hostPort` (`ploinky/cli/server/RoutingServer.js:413-427`), and for an agent enabled without an auth directive the route auth mode resolves to `none`, so `ensureAuthenticated` lets it through unauthenticated (`ploinky/cli/server/authHandlers.js:636-644,865-866`). If the decorator served `/internal/document` on the same port the router proxies to, then `https://<router-host>/onlyOffice/internal/document/<token>` would reach it **from the internet**, gated only by the opaque token — and the browser already holds that token (§3.3). **Mitigation:** the storage callbacks must listen on a loopback port/socket that is **not** the route `hostPort` and is **not** host-published, so the router has no way to forward to them; the decorator should additionally reject any non-loopback peer and validate the token. Do **not** rely on "no httpService maps `/internal`." (Contrast the current Explorer design, which maps both `/services/explorer/office/` and `/public-services/explorer/office/` to the same internal `/office/` and relies on the per-route auth tier; `explorer/manifest.json:61-73`.)

**Simpler alternative (publish the DS port directly):** keep the Document Server host-published as today (`127.0.0.1:8082:80`) and front *that* with the tunnel, instead of reverse-proxying it through the decorator. This avoids WebSocket reverse-proxying in the decorator (see §10) but makes the browser's editor surface the DS port rather than the decorator — acceptable, but slightly looser than "browser talks only to the decorator."

---

## 10. Risks, open questions, and gaps

| Item | Type | Detail |
| --- | --- | --- |
| B2 user delegation | Security dependency | Ploinky core must keep User Delegation Grant verification, MCP policy checks, and DPU Router Request `usr` claims working before Confidential persistence can remain inside OnlyOfficeAgent. Regression coverage must prove the grant is source/target/tool/scope/TTL-bound, reusable within that lease, and that Agent Assertions + Router Requests remain per-call replay-protected. |
| `/internal/*` reachable via generic passthrough | **Blocker** | The router's generic `/<agent>/...` passthrough (`RoutingServer.js:413-427`) plus default auth `none` for an agent route (`authHandlers.js:636-644,865-866`) would expose `/internal/*` to the internet if it shared the route `hostPort`. Fixed in §9.1 (dedicated loopback socket, not host-published, reject non-loopback peers). |
| WebSocket through Ploinky router | Inferred constraint | The router proxies path-prefixed HTTP and has **no WebSocket upgrade handler** (`grep` for `upgrade` in `RoutingServer.js` returns nothing); co-editing WS needs a direct reverse-proxy/tunnel to the DS, not the router. |
| Direct-disk grant breadth | Risk | OnlyOfficeAgent holding workspace RW is a broad grant. Specify the exact mount root under `.ploinky/`, the RW scope, symlink behavior, `.secrets` exclusion, and tests (I5/I6). Consider the *delegate-to-Explorer-MCP* alternative for workspace files if least privilege is paramount. |
| Document Server internal endpoints | Risk | Must explicitly block `/example`, command/convert, info/admin from the internet (§5.4). Confirm exact paths for the pinned image. |
| `ONLYOFFICE_VERSION` upgrades | Operational | Native endpoint set can change across DS versions; re-verify §5.1/§5.4 on each bump. |
| Production exposure prerequisites | Risk | DS011:164 — TLS, CSRF/origin checks, rate limiting, upload quotas are still prerequisites before broad internet exposure. |

### Claims taxonomy for this document

| Label | Applies to |
| --- | --- |
| **Observed (verified)** | §2; §4 encryption details; current manifest/route facts; the current B2 blockers that require Ploinky-core changes; the §9.1 generic-passthrough exposure (router/policy/actor code read this revision). |
| **Inferred** | The WebSocket routing constraint; "co-location makes document/callback loopback-only" (follows from the proxy + config code). |
| **Proposed** | §3; §5 tiering; §6.1/§6.3 planes; §6.2 B2 User Delegation Grant; §9 manifest & port shape. |
| **Reference (unverified here)** | OnlyOffice Document Server native endpoint names beyond `api.js` (general product knowledge; verify against the pinned `9.3.1` image). |

---

## 11. Verification criteria (acceptance, runnable/observable)

To be satisfied by the implemented architecture:

| # | Check | How to verify |
| --- | --- | --- |
| V1 | document/callback are **not** reachable from the internet by any path | Both the service path and the **generic agent path** fail from outside: `GET https://<router-host>/onlyOffice/internal/document/<any>` and `GET https://<office-host>/internal/document/<any>` return connection-refused/404 (storage callbacks are on a non-published loopback socket, §9.1). Also `grep -r '"auth": "none"' AssistOSExplorer/*/manifest.json` shows no office entry. |
| V2 | Session route requires authentication | Unauthenticated `GET /services/onlyoffice/office/session?path=...` → 401; authenticated browser → 200 with signed config. |
| V3 | Browser can edit | Load `${documentServerUrl}/web-apps/apps/api/documents/api.js` (200), open a `.docx`, edit, save; reopen shows the change. |
| V4 | Confidential round-trip stays encrypted | Edit a `/Confidential/My Space/*.docx`; on disk the dpuAgent blob is `DPUENC1:`-prefixed ciphertext, not plaintext (mirror `dpuAgent/tests/dpu-store.test.mjs:123-145`). |
| V5 | Confidential ops resolve to the **user** actor | A trace shows the router verified OnlyOfficeAgent's Agent Assertion plus the User Delegation Grant, minted a DPU Router Request with `usr` claims, and dpuAgent resolved the acting **user** (not `agent:AssistOSExplorer/onlyOffice`) as the principal for `/Confidential` reads/writes. A user lacking the ACL is denied even though OnlyOfficeAgent is the caller. |
| V6 | Path confinement holds | Session requests for `../`, symlink-escape, and `*.secrets` paths are rejected (mirror `filesystem-http-server.mjs:334-349`). |
| V7 | No master/cross-agent secrets in OnlyOfficeAgent env | Assert OnlyOfficeAgent env contains no `PLOINKY_MASTER_KEY`/`PLOINKY_DERIVED_MASTER_KEY`/`DPU_MASTER_KEY` (mirror `ploinky/tests/unit/agentEnvInjection.test.mjs`). |
| V8 | Document Server internal endpoints blocked at the edge | `GET https://<office-host>/example/` and `/coauthoring/CommandService.ashx` from the internet → blocked. |
| V9 | Tests | `cd AssistOSExplorer/onlyOffice && npm test` (if present) and `cd AssistOSExplorer/explorer && npm test` pass. |

---

## 12. Source map (evidence index)

| Topic | File(s) |
| --- | --- |
| Ploinky router proxy + header stripping | `ploinky/cli/server/routerHandlers.js:99-130,216-232,284-310`; `ploinky/cli/server/RoutingServer.js:413-427` |
| Ploinky security model & invariants | `ploinky/docs/specs/DS011-security-model.md` (esp. :24,26,88,94,98,104,106,164); `ploinky/docs/specs/DS013-per-agent-identity-and-request-signed-jwts.md`; `ploinky/docs/specs/DS014-router-access-control-http-whitelist-and-mcp-policy.md` |
| Agent-security invariants (skill ref) | `.claude/skills/manage-ploinky-agents/references/security-invariants.md` |
| dpuAgent encryption at rest | `dpuAgent/lib/dpu-store-internal/storage.mjs:14-101,300-390` |
| dpuAgent runtime/manifest | `dpuAgent/manifest.json`; `dpuAgent/docs/specs/DS05`, `DS08` |
| Current Office HTTP routes | `explorer/utils/server/onlyoffice/onlyoffice-http-routes.mjs` |
| Current config + URL rewrite | `explorer/utils/server/onlyoffice/onlyoffice-config.mjs` |
| Current persistence routing | `explorer/utils/server/onlyoffice/onlyoffice-document-store.mjs` |
| Current DPU delegation | `explorer/utils/server/onlyoffice/onlyoffice-dpu-client.mjs` |
| Explorer manifest (httpServices, secrets) | `explorer/manifest.json:61-120` |
| onlyOffice agent (current) | `onlyOffice/manifest.json`; `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md` |
| Current Office integration contract | `AssistOSExplorer/docs/specs/DS04-onlyoffice-integration.md` |
| Confidential virtual paths | `explorer/services/dpu/dpuPaths.js:1-25` |
