# WebMeet Infrastructure Architecture

This document describes how Ploinky, `AssistOSExplorer/explorer`, `webmeetAgent`, and the `webmeetInfra` Ploinky repo work together to provide the WebMeet experience inside Explorer.

Paths are relative to `/Users/danielsava/work/file-parser` unless noted.

## Scope

The current Explorer WebMeet path is:

1. `ploinky start fileExplorer/explorer <port>` or `ploinky start AchillesIDE/explorer <port>` starts Explorer as the static agent.
2. Explorer's manifest enables `webmeetAgent` and the `webmeetInfra/stack` dependency bundle.
3. `webmeetAgent` exposes the WebMeet MCP tools and ships the Explorer IDE plugin assets.
4. `webmeetInfra` runs the media infrastructure: Redis, LiveKit server, LiveKit egress, TURN/STUN, and a stack marker.

Ploinky also contains an older router-level `/webmeet` handler in `ploinky/cli/server/handlers/webmeet.js`. That handler is not the current Explorer plugin flow described here. The current UI path is the IDE plugin in `AssistOSExplorer/webmeetAgent/IDE-plugins/webmeet-tool-button`.

## Repository Roles

| Repository/path | Role |
|---|---|
| `ploinky/` | Workspace manager, manifest resolver, dependency graph starter, container runtime launcher, router, authenticated MCP proxy, secure-wire invocation token minting, and static/proxy surfaces. |
| `AssistOSExplorer/explorer/` | Static Explorer UI and filesystem MCP agent. Its manifest enables the rest of the Explorer agent pack and advertises the `webmeet` application plugin policy. |
| `AssistOSExplorer/webmeetAgent/` | App-facing WebMeet agent. Owns MCP tools, meeting persistence, LiveKit token minting, AI worker jobs, recording API calls, and the WebMeet IDE plugin assets. |
| `AssistOSExplorer/webmeetInfra/` | Separate Ploinky repo of runtime infrastructure agents consumed by `webmeetAgent` and Explorer. It does not own the app-facing WebMeet UI or meeting business logic. |

## Explorer Dependency Graph

`AssistOSExplorer/explorer/manifest.json` is the root of the runtime graph. It declares `webmeetInfra` as an external Ploinky repo and enables the WebMeet application plugin:

- `repos.webmeetInfra = https://github.com/PloinkyRepos/webmeetInfra.git`
- `enable` includes `webmeetInfra/stack` and `webmeetAgent global`
- `applicationPlugins.webmeet = true`

`webmeetAgent/manifest.json` also enables `webmeetInfra/stack`, so WebMeet infrastructure is pulled in if `webmeetAgent` is started independently.

```mermaid
flowchart TB
    Explorer["explorer static agent"]
    Git["gitAgent"]
    DPU["dpuAgent"]
    Soplang["soplangAgent"]
    Tasks["tasksAgent"]
    LLM["llmAssistant"]
    Multimedia["multimedia"]
    WebAssist["webAssist"]
    WebAdmin["webAdmin"]
    WebMeetAgent["webmeetAgent"]

    subgraph Infra["webmeetInfra repo"]
        Stack["webmeetInfra/stack"]
        Redis["webmeetRedis"]
        Coturn["webmeetCoturn"]
        LiveKit["webmeetLivekitServer"]
        Egress["webmeetLivekitEgress"]
    end

    Explorer --> Git
    Explorer --> DPU
    Explorer --> Soplang
    Explorer --> Tasks
    Explorer --> LLM
    Explorer --> Multimedia
    Explorer --> WebAssist
    Explorer --> WebAdmin
    Explorer --> WebMeetAgent
    Explorer --> Stack

    WebMeetAgent --> Stack
    Stack --> Redis
    Stack --> Coturn
    Stack --> LiveKit
    Stack --> Egress
    LiveKit --> Redis
    Egress --> LiveKit
    Egress --> Redis
```

Ploinky resolves this graph recursively with `workspaceDependencyGraph.js`, enables missing graph nodes in `.ploinky/agents.json`, starts nodes in topological waves, waits for readiness after each wave, writes `.ploinky/routing.json`, and finally launches the host-side `Watchdog.js` plus `RoutingServer.js`.

Expected WebMeet-related startup order:

| Wave | Agents |
|---|---|
| 1 | Non-WebMeet Explorer dependencies plus `webmeetRedis` and `webmeetCoturn` |
| 2 | `webmeetLivekitServer` |
| 3 | `webmeetLivekitEgress` |
| 4 | `webmeetInfra/stack` |
| 5 | `webmeetAgent` |
| 6 | `explorer` |

The exact wave labels also include the other Explorer agents. `start_only` manifests use TCP readiness; normal MCP agents use an MCP handshake.

## WebMeet Infrastructure Agents

| Agent | Container | Main job | Network | Important ports in `dev` profile | Notes |
|---|---|---|---|---|---|
| `webmeetInfra/stack` | `docker.io/library/busybox:1.36` | Dependency bundle and readiness marker | default Ploinky network | random host port to container `7000` unless already specified by Ploinky | Starts a tiny `httpd` with `ok`. It depends on all infra agents and gives Ploinky a single bundle node. |
| `webmeetRedis` | `docker.io/library/redis:7-alpine` | LiveKit state bus | `webmeet`, alias `webmeetRedis` | `16379:6379` | LiveKit server and egress refer to `webmeetRedis:6379`. Redis state is runtime state, not the durable WebMeet meeting store. |
| `webmeetCoturn` | `docker.io/coturn/coturn:4.6.2` | TURN/STUN relay | host-published ports; no `webmeet` alias | `13478:3478/tcp`, `13478:3478/udp`, `20000-20010:20000-20010/udp` | Runs with default dev credentials unless profile/env overrides are supplied. `webmeetAgent` can return TURN ICE servers in the join payload, and the browser passes them to LiveKit through `rtcConfig`. |
| `webmeetLivekitServer` | `docker.io/livekit/livekit-server:latest` | LiveKit SFU and LiveKit API | `webmeet`, alias `webmeetLivekitServer` | `17880:7880`, `17881:17881`, `17882-17892:17882-17892/udp` | Depends on Redis. A host preinstall hook generates `.ploinky/agents/webmeetLivekitServer/livekit.yaml`, mounted at `/code/livekit.yaml`. |
| `webmeetLivekitEgress` | `docker.io/livekit/egress:latest` | Recording worker | `webmeet`, alias `webmeetLivekitEgress` | `17980:7980` | Depends on LiveKit server and Redis. A host preinstall hook generates `.ploinky/agents/webmeetLivekitEgress/egress.yaml`. It mounts `webmeet/recordings` at `/recordings` and requires `SYS_ADMIN`. |

Default profile ports are similar but use host `7880/7881/7882-7892`, `7980`, `6379`, and `3478`. The `prod` profile binds public-facing infra ports to `0.0.0.0` and makes key LiveKit/TURN variables required.

## Generated LiveKit Configuration

The checked-in `webmeetLivekitServer/livekit.yaml` and `webmeetLivekitEgress/egress.yaml` files are placeholders. The actual files used at runtime are generated under `.ploinky/agents/...` by host preinstall hooks before the containers start.

`webmeetLivekitServer/scripts/hooks/preinstall.sh` writes:

- `port: 7880` for HTTP API and WebSocket signaling.
- `rtc.tcp_port`, used as a TCP fallback media path.
- `rtc.port_range_start` and `rtc.port_range_end`, used for UDP media sockets.
- `rtc.use_external_ip`, controlled by `WEBMEET_LIVEKIT_USE_EXTERNAL_IP`.
- Optional `rtc.node_ip` in dev, defaulting to `127.0.0.1` when external IP mode is off.
- `redis.address: webmeetRedis:6379`.
- The LiveKit API key/secret map under `keys`.

In the current `dev` profile, the host publishes LiveKit as:

- `17880:7880` for signaling and LiveKit API calls from the browser.
- `17881:17881` for the LiveKit TCP media fallback configured in generated YAML.
- `17882-17892:17882-17892/udp` for UDP media sockets.

The container still listens on `7880`, but the generated RTC media ports intentionally use the host-published development range. In `default` and `prod`, the generated RTC media ports are `7881` and `7882-7892/udp`.

`webmeetLivekitEgress/scripts/hooks/preinstall.sh` writes:

- `ws_url: ws://webmeetLivekitServer:7880`, which is the internal WebSocket path egress uses to join LiveKit rooms.
- `api_key` and `api_secret`, matching the LiveKit server keys.
- `redis.address: webmeetRedis:6379`.
- `health_port: 7980`.
- `insecure: true`, because egress talks to LiveKit over the private `webmeet` container network rather than TLS.

The egress container mounts `webmeet/recordings` at `/recordings` and receives `SYS_ADMIN`, which is required by the upstream LiveKit egress image for browser/compositor sandboxing. Treat egress as a privileged media-processing container and keep it off untrusted networks.

## Runtime Topology

```mermaid
flowchart LR
    Browser["Explorer browser tab"]
    Router["Ploinky RoutingServer"]
    Explorer["explorer container\nstatic UI + filesystem MCP"]
    WebMeet["webmeetAgent container\nAgentServer + API + worker"]
    Store["workspace .ploinky/webmeet\nJSON records + jobs + events"]
    Recordings["workspace webmeet/recordings"]

    subgraph WebMeetNet["podman/docker network: webmeet"]
        Redis["webmeetRedis:6379"]
        LiveKit["webmeetLivekitServer:7880"]
        Egress["webmeetLivekitEgress:7980"]
    end

    Coturn["webmeetCoturn\nhost UDP/TCP relay ports"]

    Browser -->|"GET /, plugin assets"| Router
    Router --> Explorer
    Browser -->|"/mcps/webmeetAgent/mcp tools/call"| Router
    Router --> WebMeet
    WebMeet --> Store
    Browser -->|"LiveKit WebSocket + WebRTC"| LiveKit
    Browser -. "ICE relay if configured" .-> Coturn
    LiveKit --> Redis
    Egress --> Redis
    Egress --> LiveKit
    Egress --> Recordings
    WebMeet -->|"Twirp egress API via LiveKit server"| LiveKit
```

`webmeetAgent` joins the `webmeet` network so it can resolve the internal LiveKit services by alias. It also gets Ploinky runtime router variables such as `PLOINKY_ROUTER_URL`, but the UI path normally enters it through the router MCP proxy, not through direct container-to-router calls.

## Room Discovery And Participant Rendezvous

WebMeet users do not discover rooms through LiveKit or Redis. Room discovery is an application-plane operation owned by `webmeetAgent`.

For authenticated Explorer users:

1. The Explorer WebMeet plugin calls `webmeet_workspace_list`.
2. `webmeetAgent` derives the current workspace id from the workspace root and ensures a workspace JSON record under `.ploinky/webmeet/workspaces`.
3. The plugin calls `webmeet_meeting_list` for that workspace id.
4. `webmeetAgent` reads `.ploinky/webmeet/meetings/*.json`, filters active rooms for the current workspace, and returns room cards to the UI.
5. Admin users can create, rename, delete, and expose guest invite links. Non-admin users can see and join active rooms returned for the workspace, but they do not receive guest invite tokens.

For guests:

1. An admin creates a `guest` room. `webmeetAgent` stores a random `guestToken` in the meeting record.
2. The UI builds `/public-services/webmeet/guest?room=<meetingId>&token=<guestToken>`.
3. Ploinky routes that path through the manifest-declared guest HTTP service with `forceGuest: true`, so the request receives a scoped guest identity even if the browser has another workspace session.
4. `webmeet-public-proxy.mjs` verifies the router-issued `__http_service__` invocation token and only then serves the guest page and guest API calls.
5. The guest join API verifies the room id and guest token, then creates or refreshes a guest participant identity before returning meeting state and a LiveKit participant token. Later guest state, chat, transcript, presence, and leave calls verify that participant identity against the meeting payload.

Once a user joins, there are two participant views:

- WebMeet presence is durable application state in the encrypted meeting payload. `joinMeeting()` and `joinGuestMeeting()` add or refresh `payload.members`, the browser sends `webmeet_meeting_presence_ping` every 10 seconds, `leaveMeeting()` removes the participant, and stale entries are removed after `PLOINKY_WEBMEET_PRESENCE_TTL_MS` or the default 30 seconds.
- Live media presence is LiveKit room state. After `room.connect(...)`, the browser receives LiveKit participant and track events. The UI uses those events to render remote video/audio and to subscribe to published tracks. Redis supports LiveKit's internal room and node coordination, but users never query Redis to find each other.

## LiveKit Server Processing Model

The LiveKit server is the real-time media SFU. It is not an application server for WebMeet chat, meetings, summaries, or durable artifacts. Its primary jobs are signaling, room membership for media sessions, track publication, track subscription, packet routing, and media-session health.

When a participant joins:

1. The browser first calls the `webmeet_meeting_join` MCP tool through Ploinky.
2. `webmeetAgent` updates durable meeting presence and returns `livekitUrl`, `roomName`, and a LiveKit participant JWT.
3. The browser's LiveKit client opens a WebSocket signaling connection to the LiveKit URL.
4. LiveKit validates the JWT against the configured API key/secret and checks that the token permits joining that room.
5. The browser and LiveKit negotiate WebRTC transports, usually UDP when reachable and TCP fallback when needed.
6. The browser publishes microphone, camera, or screen-share tracks only when the user enables those controls.

Once media is active, LiveKit performs SFU work:

- It terminates each browser's WebRTC connection and manages the DTLS-SRTP transport security for that hop.
- It receives RTP/RTCP packets for published audio/video/screen tracks.
- It tracks subscriber interest and forwards selected streams to the right participants.
- It handles bandwidth estimation, congestion feedback, NACK/PLI retransmission requests, simulcast/SVC layer selection where available, and track mute/unmute state.
- It re-encrypts media for each receiving WebRTC connection.
- It exposes room and egress control APIs over its HTTP/Twirp surface.

LiveKit normally forwards media rather than transcoding it. Browser clients encode their own microphone/camera/screen media. LiveKit chooses which encoded layers to forward and manages transport behavior, but room compositing and file encoding are handled by the separate egress worker, not by the main LiveKit server.

Because end-to-end media encryption is not configured in this codebase, LiveKit is a trusted media server. Browser-to-LiveKit and LiveKit-to-browser media hops are encrypted in transit by WebRTC transport security, but the SFU terminates those connections so it can route media. In practical terms: LiveKit decrypts the transport hop, can access the encoded media packets and data-channel payloads needed for SFU routing, and then re-encrypts traffic for each subscriber. It does not normally decode and re-encode the raw camera, microphone, or screen frames for ordinary room forwarding. Egress is the component that subscribes to room media, renders/composites the room, encodes an MP4, and writes it to disk.

Signaling and API traffic are only encrypted in transit when the public endpoint uses `wss://` or `https://`. The current development defaults use `ws://127.0.0.1:17880` for browser signaling and `http://webmeetLivekitServer:7880` for server-side API calls on the private container network. Public deployments must terminate TLS for the browser-facing LiveKit URL.

## Screen Share Flow

Screen sharing is a browser media flow, not an MCP stream.

```mermaid
sequenceDiagram
    participant User
    participant Browser as WebMeet modal
    participant LiveKitClient as LiveKit JS client
    participant LiveKit as LiveKit server
    participant Remote as Remote browsers
    participant Egress as Egress worker

    User->>Browser: Click screen share
    Browser->>LiveKitClient: localParticipant.setScreenShareEnabled(true)
    LiveKitClient->>Browser: Browser screen-capture permission prompt
    Browser->>LiveKit: Publish ScreenShare video track over WebRTC
    LiveKit->>Remote: Notify track publication and forward subscribed packets
    Remote->>Remote: Attach remote video element
    LiveKit-->>Egress: Forward track if recording is active
```

`webmeet-media-controller.js` keeps camera and screen share mutually exclusive in the current UI. Starting screen share first disables the camera publication when it is active; starting the camera disables screen share. The local browser captures and encodes the screen. LiveKit receives the screen-share RTP stream, forwards it to interested subscribers, and egress records it only when a room-composite recording is active. Remote browsers attach the subscribed screen-share track to a video element and verify that the element actually becomes frame-ready; if the SDK exposes a remote track but no frames arrive, the UI performs a delayed subscription refresh for that publication.

## Redis Boundary

Redis is configured in both generated LiveKit files:

- `webmeetLivekitServer` writes `redis.address: webmeetRedis:6379`.
- `webmeetLivekitEgress` writes the same Redis address so egress can coordinate with the LiveKit server.

With Redis configured, LiveKit uses Redis for LiveKit room data, node coordination, and message-bus behavior. Egress uses Redis messaging queues to communicate with LiveKit and to distribute work when multiple egress workers exist. In this repository's single-node bundle, Redis is still runtime infrastructure state for LiveKit and egress; it is not WebMeet's durable room store.

Redis may contain short-lived LiveKit room, participant, node, routing, and egress coordination data, and the `redis-server --save 60 1` command can snapshot that runtime state to an RDB file. It must not be treated as the source of truth for:

- WebMeet room lists or titles.
- Guest invite tokens.
- Chat history.
- Transcript segments.
- AI artifacts, tasks, decisions, or observer summaries.
- Recording artifact metadata.
- Media packets or MP4 recordings.

Those application records live under `.ploinky/webmeet` and recording files live under `webmeet/recordings`.

## Ploinky Startup And Routing

```mermaid
sequenceDiagram
    participant CLI as ploinky start
    participant Graph as Dependency graph
    participant Runtime as Container runtime
    participant Routes as .ploinky/routing.json
    participant Watchdog as Watchdog
    participant Router as RoutingServer

    CLI->>Graph: Resolve explorer manifest enable tree
    Graph-->>CLI: Topological waves
    CLI->>Routes: Seed static agent and router port
    loop Each dependency wave
        CLI->>Runtime: ensureAgentService(agent, routerPort)
        Runtime-->>CLI: containerName and hostPort
        CLI->>Routes: write route entry
        CLI->>Runtime: readiness probe
    end
    CLI->>Watchdog: spawn with workspace env
    Watchdog->>Router: spawn/restart child process
    Router->>Routes: load agent host ports for proxying
```

For containers, Ploinky appends runtime-owned router env after manifest/profile/secret env so stale workspace variables cannot override the live router port. This matters for WebMeet only indirectly, but it is critical for any agent-to-agent calls made from WebMeet tools or other Explorer agents.

## Explorer Plugin Discovery

Explorer does not hard-code the WebMeet UI. It asks its own MCP server for runtime IDE plugins:

1. Browser loads `explorer/main.js`.
2. `main.js` calls Explorer MCP tool `collect_ide_plugins`.
3. `explorer/utils/ide-plugins.mjs` scans the workspace and `.ploinky/repos/*/*/IDE-plugins`.
4. The WebMeet plugin config at `webmeetAgent/IDE-plugins/webmeet-tool-button/config.json` is returned.
5. Explorer filters the plugin through `applicationPlugins.webmeet`.
6. The toolbar button opens `webmeet-dashboard-modal`.

```mermaid
sequenceDiagram
    participant Browser
    participant ExplorerUI as explorer main.js
    participant ExplorerMCP as explorer MCP server
    participant Scanner as ide-plugins.mjs
    participant Plugin as webmeetAgent IDE plugin

    Browser->>ExplorerUI: Load Explorer
    ExplorerUI->>ExplorerMCP: collect_ide_plugins
    ExplorerMCP->>Scanner: aggregateIdePlugins(workspaceRoot)
    Scanner->>Plugin: read config.json and assets
    Plugin-->>Scanner: webmeet toolbar and modal config
    Scanner-->>ExplorerMCP: grouped runtime plugins
    ExplorerMCP-->>ExplorerUI: JSON plugin payload
    ExplorerUI->>Browser: register toolbar button and modal components
```

## WebMeet Agent Internals

`webmeetAgent/scripts/startAgent.sh` starts four processes in one container:

| Process | Role |
|---|---|
| `node /code/server/webmeet-api.mjs` | Internal HTTP API on `WEBMEET_API_PORT` (default `8791`). It mirrors the main WebMeet operations, but the Explorer plugin currently uses MCP tools instead. |
| `node /code/server/webmeet-worker.mjs` | Polls persistent job files for `observer_refresh`, `assistant_reply`, and `scribe_finalize`. |
| `sh /Agent/server/AgentServer.sh` | Ploinky AgentServer on `WEBMEET_MCP_PORT` (default `7001`), exposing tools from `webmeetAgent/mcp-config.json`. |
| `node /code/server/webmeet-public-proxy.mjs` | Ploinky-facing WebMeet front door on the assigned `PORT`. It bridges `/mcp` to the internal AgentServer for normal Ploinky routing, and serves only the guest page, guest assets, and guest-token API calls for the `webmeetAgent/manifest.json` HTTP service at `/public-services/webmeet/...`; guest HTTP calls must carry a router-issued `__http_service__` invocation token with a guest role. |

Every MCP tool in `mcp-config.json` runs `tools/webmeet_tool.sh`, which launches `tools/webmeet_tool.mjs` as a fresh subprocess. Tool calls are stateless at the process level and share state through the workspace store.

```mermaid
flowchart TB
    AgentServer["Ploinky AgentServer\n/webmeetAgent /mcp"]
    ToolConfig["mcp-config.json"]
    ToolShim["tools/webmeet_tool.sh"]
    ToolJS["tools/webmeet_tool.mjs"]
    Store["lib/webmeetStore.mjs"]
    Queue["lib/webmeetQueue.mjs"]
    Worker["server/webmeet-worker.mjs"]
    LLM["achillesAgentLib/LLMAgents"]
    HTTP["server/webmeet-api.mjs"]

    AgentServer --> ToolConfig
    ToolConfig --> ToolShim
    ToolShim --> ToolJS
    ToolJS --> Store
    HTTP --> Store
    Store --> Queue
    Worker --> Queue
    Worker --> Store
    Worker --> LLM
```

## User Flow: Join A Room

```mermaid
sequenceDiagram
    participant User
    participant Browser as WebMeet modal
    participant Router as Ploinky router
    participant Agent as webmeetAgent AgentServer
    participant Tool as webmeet_tool.mjs
    participant Store as webmeetStore
    participant LiveKit as LiveKit server

    User->>Browser: Select room and click Join
    Browser->>Router: tools/call webmeet_meeting_join
    Router->>Agent: tools/call with router-minted invocation JWT
    Agent->>Tool: spawn tool subprocess with metadata
    Tool->>Store: joinMeeting(meetingId, participantId)
    Store->>Store: update encrypted meeting payload
    Store-->>Tool: roomName, participant, LiveKit URL, JWT token
    Tool-->>Agent: JSON result
    Agent-->>Router: MCP result
    Router-->>Browser: join payload
    Browser->>LiveKit: room.connect(livekitUrl, participantToken)
    Browser->>Router: heartbeat webmeet_meeting_presence_ping every 10s
```

The LiveKit participant token is created locally by `webmeetStore.mjs` using `WEBMEET_LIVEKIT_API_KEY` and `WEBMEET_LIVEKIT_API_SECRET`. The browser receives `WEBMEET_PUBLIC_LIVEKIT_URL` as `livekitUrl`.

## User Flow: Chat, Transcript, And AI Agents

```mermaid
sequenceDiagram
    participant Browser
    participant Router
    participant Agent as webmeetAgent
    participant Store
    participant Queue
    participant Worker
    participant LLM

    Browser->>Router: webmeet_chat_send
    Router->>Agent: secure tools/call
    Agent->>Store: appendMeetingChat
    Store->>Queue: enqueue observer_refresh if observer attached
    Store->>Queue: enqueue assistant_reply if message mentions @WebMeetAgent
    Agent-->>Browser: chat result, waits for assistant reply job when needed
    Worker->>Queue: claim pending job
    Worker->>Store: build meeting AI context
    Worker->>LLM: generate summary or assistant response
    Worker->>Store: persist observerState or agent chat message
    Worker->>Queue: mark job done
    Browser->>Router: reload chat/transcript/artifacts/agents
```

Transcript follows the same persistence path. Manual transcript entries and browser `SpeechRecognition` entries call `webmeet_transcript_append`. If an observer agent is attached, transcript updates enqueue `observer_refresh`.

## User Flow: Recording

```mermaid
sequenceDiagram
    participant Browser
    participant Router
    participant Agent as webmeetAgent
    participant Store
    participant LiveKit as LiveKit server API
    participant Egress as LiveKit egress worker
    participant Files as /recordings volume

    Browser->>Router: webmeet_recording_start
    Router->>Agent: secure tools/call
    Agent->>LiveKit: StartRoomCompositeEgress Twirp call
    LiveKit->>Egress: assign egress through LiveKit/Redis control plane
    Egress->>LiveKit: subscribe to room media
    Egress->>Files: write MP4 under meeting folder
    Agent->>Store: persist recording metadata
    Browser->>Router: webmeet_recording_stop
    Router->>Agent: secure tools/call
    Agent->>LiveKit: StopEgress Twirp call
    Agent->>Store: persist recording artifact metadata
```

`WEBMEET_EGRESS_URL` is currently stored in recording metadata, while actual egress control calls go through `WEBMEET_LIVEKIT_URL` and LiveKit's `/twirp/livekit.Egress/*` API.

## Persistent Data Model

The durable WebMeet store is under the workspace, not inside Redis:

| Path | Contents |
|---|---|
| `.ploinky/webmeet/workspaces/*.json` | Current workspace record derived from workspace root. |
| `.ploinky/webmeet/meetings/*.json` | Meeting records. Each record has metadata plus an encrypted payload containing members, agents, chat, transcript, recordings, artifacts, tasks, decisions, and events. |
| `.ploinky/webmeet/events/<meetingId>/*.json` | Event log entries. |
| `.ploinky/webmeet/jobs/pending` | AI jobs waiting for the worker. |
| `.ploinky/webmeet/jobs/processing` | Jobs claimed by the worker. |
| `.ploinky/webmeet/jobs/done` | Completed jobs with results. |
| `.ploinky/webmeet/jobs/failed` | Failed jobs with error messages. |
| `webmeet/recordings` | Shared recording volume mounted into `webmeetAgent` and `webmeetLivekitEgress`. |

Meeting payload encryption uses a per-meeting DEK wrapped by `PLOINKY_WEBMEET_MASTER_KEY`. That variable is a dedicated WebMeet data key and must be injected through Ploinky encrypted variables or another explicit secret-management path. `webmeetStore.mjs` no longer uses `PLOINKY_MASTER_KEY` or `PLOINKY_WIRE_SECRET` for new meeting encryption; missing data-key configuration fails closed. A legacy decrypt-only path can unwrap records created by the older `PLOINKY_WIRE_SECRET` fallback and rewrap them with `PLOINKY_WEBMEET_MASTER_KEY` on the next meeting write.

Meeting JSON writes are atomic (`temp + rename`) because multiple WebMeet tool subprocesses can touch the same meeting record concurrently.

## Authentication And Authorization

```mermaid
sequenceDiagram
    participant Browser
    participant Router
    participant Proxy as MCP proxy
    participant Agent as AgentServer
    participant Tool as webmeet_tool

    Browser->>Router: Authenticated /mcps/webmeetAgent/mcp JSON-RPC
    Router->>Proxy: ensure user session and resolve target route
    Proxy->>Proxy: mint invocation JWT for tool name and body
    Proxy->>Agent: tools/call with Authorization: Bearer JWT
    Agent->>Agent: verify PLOINKY_WIRE_SECRET, audience, body, tool
    Agent->>Tool: spawn with invocation metadata
    Tool->>Tool: extract user/roles from invocation
```

Admin-only WebMeet operations (`webmeet_meeting_create`, `webmeet_meeting_rename`, and `webmeet_close_meeting`) are enforced inside `webmeetStore.mjs` using the invocation-derived user info. A user is treated as admin if they have the `admin` role, username `admin`, id `local:admin`, or principal `user:local:admin`.

## WebMeet Security Model

WebMeet uses different security controls for the application plane, media plane, recording plane, and stored data.

| Boundary | Protection in current code | Important limits |
|---|---|---|
| Browser to Ploinky MCP | Browser calls go through the authenticated Ploinky router and MCP proxy. The proxy mints invocation metadata for tool calls. | This protects WebMeet application tools, not direct browser-to-LiveKit media sockets. |
| Ploinky to `webmeetAgent` | The WebMeet public proxy forwards MCP handshake and metadata methods to AgentServer, but executable MCP methods require router-minted invocation JWTs using `PLOINKY_WIRE_SECRET`; AgentServer verifies the same token before spawning tools. | Tools must continue to derive authorization from invocation metadata, not from user-supplied fields. Tool/resource metadata remains listable for router discovery. |
| Guest invite HTTP surface | `webmeetAgent/manifest.json` declares `/public-services/webmeet/...` as a guest HTTP service, so Ploinky routes it to the WebMeet proxy as `/api/...` with `x-ploinky-auth-info.invocationToken`. The proxy verifies the token audience, `__http_service__` tool binding, body hash, and guest role before serving the guest page or proxying guest API calls. WebMeet intentionally does not use manifest-level `guest: true` like visitor-only agents such as webAssist, because guest invite users must not reach the agent's general MCP tools. | Guest users must only be routed through the WebMeet public service path. Do not expose Explorer, generic agent MCP routes, or non-guest WebMeet APIs through a public route. |
| Admin room management | `webmeetStore.mjs` gates create, rename, and close operations with `assertAdminAuthInfo()`. | Join, chat, transcript, recording, and agent attach operations currently do not all have admin-only checks. |
| LiveKit participant access | `webmeetAgent` signs LiveKit JWTs with `WEBMEET_LIVEKIT_API_SECRET`. Tokens are scoped to one room and grant `roomJoin`, `canPublish`, `canSubscribe`, and `canPublishData`. | Tokens currently last 8 hours. Anyone who obtains a participant token can use those grants until expiry. |
| LiveKit server API | Egress control calls use a short-lived server JWT with `roomRecord: true` against `WEBMEET_LIVEKIT_URL`. API key/secret stay server-side. | The LiveKit API/signaling port is also the browser WebSocket endpoint. If exposed publicly, protect it with strong keys, firewalling, and TLS termination. |
| LiveKit media transport | WebRTC uses encrypted media transports between browser and LiveKit. | No application-level end-to-end media encryption is configured, so LiveKit is trusted with media contents while routing. |
| Redis | LiveKit and egress use Redis at `webmeetRedis:6379` for runtime coordination on the `webmeet` network. | Redis has no app data durability role and no auth in the manifest. Publishing Redis to a public interface would be unsafe. |
| TURN/STUN | Coturn uses long-term credentials and publishes relay ports. `prod` requires `WEBMEET_TURN_EXTERNAL_IP` and `WEBMEET_TURN_PASSWORD`. When those values are present, `webmeetAgent` returns TURN ICE servers in `rtcConfig` and the browser passes them into `room.connect(...)`. | The manifest disables TLS/DTLS for TURN and uses static credentials. With `WEBMEET_ICE_TRANSPORT_POLICY=all`, TURN is a fallback; clients may still choose direct LiveKit media candidates when those work. |
| Durable meeting data | Meeting payloads are AES-256-GCM encrypted with a per-meeting DEK wrapped by `PLOINKY_WEBMEET_MASTER_KEY`. Writes are atomic temp-file renames. | Metadata outside encrypted payloads remains visible in meeting JSON. Losing or rotating the master key without migration makes stored payloads unreadable. |
| Recordings | Egress writes MP4 files to the shared `webmeet/recordings` volume. `webmeetAgent` stores artifact metadata. | Recording files are not encrypted by the WebMeet store layer. Access control depends on workspace filesystem/container exposure. |

Deployment hardening points:

- Use `wss://` for `WEBMEET_PUBLIC_LIVEKIT_URL` on public deployments.
- Keep `WEBMEET_LIVEKIT_URL` internal when possible.
- Do not expose Redis or egress health/control surfaces publicly.
- Replace dev credentials (`devkey`, `devsecret...`, TURN `webmeet:webmeet`) in any shared environment.
- Firewall LiveKit UDP/TCP media ranges and TURN relay ranges intentionally.
- Configure and verify TURN details in the browser LiveKit `rtcConfig` before relying on coturn for hostile NAT/firewall environments.
- Keep `PLOINKY_WEBMEET_MASTER_KEY`, `WEBMEET_LIVEKIT_API_SECRET`, `WEBMEET_TURN_PASSWORD`, and Ploinky wire secrets out of logs and client payloads.

## Configuration And Public Deployment Notes

The skills deployment workflow defaults to the `prod` Ploinky profile unless a workflow input or repository variable overrides it. Production WebMeet manifests require explicit LiveKit, TURN, and WebMeet data-encryption secrets so generated configs do not silently fall back to development credentials.

Important WebMeet variables:

| Variable | Used by | Development default | Production note |
|---|---|---|---|
| `WEBMEET_PUBLIC_LIVEKIT_URL` | Browser join payload | `ws://127.0.0.1:17880` in `dev`, `ws://127.0.0.1:7880` in `default` | Must be a browser-reachable `ws://` or `wss://` URL for public deployments. |
| `WEBMEET_LIVEKIT_URL` | `webmeetAgent` server-side API calls | `http://webmeetLivekitServer:7880` | Should remain internal unless LiveKit is externalized. |
| `WEBMEET_LIVEKIT_API_KEY` | LiveKit tokens and API auth | `devkey` in the explicit `dev` profile | Required in `prod`; no development fallback in `default` or `prod`. |
| `WEBMEET_LIVEKIT_API_SECRET` | LiveKit tokens and API auth | `devsecretdevsecretdevsecretdevsecret` in the explicit `dev` profile | Required in `prod`; no development fallback in `default` or `prod`. |
| `WEBMEET_EGRESS_URL` | Recording metadata and runtime validation | `http://webmeetLivekitEgress:7980` | Required in `prod`. |
| `WEBMEET_TURN_EXTERNAL_IP` | Coturn advertised external IP | `127.0.0.1` | Required in `prod`. |
| `WEBMEET_TURN_PASSWORD` | Coturn long-term credential | `webmeet` in the explicit `dev` profile | Required in `prod`; no development fallback in `default` or `prod`. |
| `PLOINKY_WEBMEET_MASTER_KEY` | Meeting payload encryption | `dev-webmeet-master-key` in the explicit `dev` profile | Required in `prod`; no development fallback in `default` or `prod`, and the value must remain stable for stored meetings to decrypt. |

For a public URL like `https://skills.axiologic.dev`, the browser cannot use a loopback LiveKit URL unless it is running on the same host. A production-ready public WebMeet deployment needs a public LiveKit WebSocket endpoint, public RTP/TCP/UDP media routing, and TURN details wired into the client if relay is required.

## Capacity And Bottleneck Analysis

The current deployment is a single LiveKit server, one Redis instance, one coturn container, and one egress worker. That is adequate for a small-room workspace, but there are several scaling points to watch when many users join rooms at the same time.

| Component | Bottleneck risk | Why it can bottleneck | Signals to watch |
|---|---|---|---|
| LiveKit server network egress | High | Each published track can be forwarded to many subscribers. Server outbound bandwidth grows with participants, subscribed tracks, selected video layers, and screen shares. | NIC throughput, packet loss, LiveKit connection quality, high RTT, clients receiving lower layers. |
| LiveKit server CPU | Medium to high | SFU packet routing is lighter than transcoding, but the server still handles WebRTC transport encryption, RTCP feedback, packet retransmission, subscription decisions, and per-peer state. | Container CPU, scheduler latency, LiveKit logs, increasing reconnects. |
| LiveKit UDP media port range | Medium | The manifests expose only `7882-7892/udp` or `17882-17892/udp`, a narrow range for concurrent WebRTC media sockets. | New participants fail ICE/connect while signaling succeeds. |
| Browser clients | Medium | Each participant decodes remote media. Large rooms with many visible video tiles can overload client CPU/GPU before the server is saturated. | Browser CPU, dropped frames, UI jank, thermal throttling. |
| Egress worker | High during recording | Room composite recording subscribes to room media, renders/composites, encodes MP4, and writes to disk. This is much heavier than normal SFU forwarding. | Egress CPU/memory, slow recording start, failed egress jobs, delayed MP4 finalization. |
| Recording volume I/O | Medium | Long or concurrent recordings write large files to `webmeet/recordings`. | Disk usage, write latency, incomplete recording files. |
| Coturn | High when relay is used | TURN relays all media through coturn when direct WebRTC paths fail, doubling relay bandwidth pressure and adding CPU/socket load. | TURN port bandwidth, relay allocation count, users behind restrictive NAT. |
| Redis | Low to medium for this scale | LiveKit uses Redis for coordination/state. It is not carrying media packets, but it becomes important if LiveKit is clustered or room churn is high. | Redis CPU/memory, command latency, reconnect logs. |
| `webmeetAgent` tool subprocesses | Low for media, medium for chat/AI bursts | It is outside the media path, but each MCP tool call spawns a subprocess and writes JSON files. AI jobs are serialized by the worker. | MCP latency, job backlog size, file write errors. |

The main rule is that WebMeet media load is not proportional to MCP/API traffic. Once users are connected, the pressure is on LiveKit network egress and WebRTC session handling. For a room with `N` participants where everyone publishes camera and microphone, each browser sends roughly one local set of tracks to LiveKit, while LiveKit may send up to `N - 1` remote participant track sets back to each user depending on subscription decisions and selected media layers. LiveKit's aggregate outbound traffic therefore grows much faster than per-client uplink.

Specific current-code constraints:

- The browser creates a LiveKit `Room` with `adaptiveStream: false` and `dynacast: false`, then connects with `autoSubscribe: true`; WebMeet also runs explicit subscription sweeps after connect and publication events as a recovery path.
- Those adaptive media optimizations stay disabled because the current modal renders video elements after room events and needs remote video and screen-share downtracks to be negotiated immediately after subscription.
- A remote video publication is not treated as healthy just because the LiveKit SDK exposes a track object. After attaching the `<video>` element, the UI checks for frame-ready state and performs a delayed unsubscribe/resubscribe refresh if the element remains empty.
- The UI currently allows one camera or one screen share per participant; starting screen share disables camera and starting camera disables screen share. That limits per-user video tracks.
- Custom ICE servers are returned in the join payload when TURN env vars are configured, and `buildRtcConfigForSession()` passes them to LiveKit. With `WEBMEET_ICE_TRANSPORT_POLICY=all`, TURN remains a fallback instead of forcing all traffic through coturn.
- The single egress worker means simultaneous room-composite recordings can become the first CPU bottleneck.
- The single LiveKit node has no documented horizontal scaling or external load balancer in this repo.

Scaling options when load grows:

- Expand the LiveKit UDP port range and confirm firewall/NAT rules match it.
- Put the public LiveKit endpoint behind TLS and route media ports directly to the LiveKit host.
- Keep explicit TURN `iceServers` wiring enabled for restrictive networks, and use relay-only mode only for controlled smoke tests or networks that require it.
- Move recordings to dedicated egress capacity or limit concurrent recordings.
- Monitor LiveKit and egress containers separately; normal calls and recordings have very different resource profiles.
- For larger deployments, use LiveKit's multi-node pattern with Redis-backed coordination and an appropriate load-balancing strategy, rather than relying on this single-node Ploinky bundle.

## Operational Checks

Useful checks after startup:

```sh
ploinky status
podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
podman exec <webmeetAgent-container> node /code/server/validate-runtime.mjs
```

Expected WebMeet containers:

- `webmeetRedis`
- `webmeetCoturn`
- `webmeetLivekitServer`
- `webmeetLivekitEgress`
- `stack`
- `webmeetAgent`

If LiveKit or egress fails to start, inspect the generated files:

- `.ploinky/agents/webmeetLivekitServer/livekit.yaml`
- `.ploinky/agents/webmeetLivekitEgress/egress.yaml`

If the WebMeet UI can list rooms but media does not connect, verify:

- `webmeet_meeting_join` returns a non-empty `participantToken`.
- `livekitUrl` is reachable from the browser.
- LiveKit media ports are published correctly for the active profile.
- TURN configuration is reachable and actually supplied to the browser client when needed.

## Source Files Reviewed

Primary Ploinky files:

- `ploinky/cli/services/workspaceDependencyGraph.js`
- `ploinky/cli/services/workspaceUtil.js`
- `ploinky/cli/services/docker/agentServiceManager.js`
- `ploinky/cli/services/startupReadiness.js`
- `ploinky/cli/server/RoutingServer.js`
- `ploinky/cli/server/mcp-proxy/index.js`
- `ploinky/Agent/server/AgentServer.mjs`

Primary Explorer/WebMeet files:

- `AssistOSExplorer/explorer/manifest.json`
- `AssistOSExplorer/explorer/main.js`
- `AssistOSExplorer/explorer/utils/ide-plugins.mjs`
- `AssistOSExplorer/webmeetAgent/manifest.json`
- `AssistOSExplorer/webmeetAgent/mcp-config.json`
- `AssistOSExplorer/webmeetAgent/scripts/startAgent.sh`
- `AssistOSExplorer/webmeetAgent/lib/webmeetStore.mjs`
- `AssistOSExplorer/webmeetAgent/lib/webmeetQueue.mjs`
- `AssistOSExplorer/webmeetAgent/lib/webmeetCrypto.mjs`
- `AssistOSExplorer/webmeetAgent/server/webmeet-api.mjs`
- `AssistOSExplorer/webmeetAgent/server/webmeet-public-proxy.mjs`
- `AssistOSExplorer/webmeetAgent/server/webmeet-worker.mjs`
- `AssistOSExplorer/webmeetAgent/server/validate-runtime.mjs`
- `AssistOSExplorer/webmeetAgent/IDE-plugins/webmeet-tool-button/config.json`
- `AssistOSExplorer/webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/webmeet-dashboard-modal.js`
- `AssistOSExplorer/webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js`
- `AssistOSExplorer/webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/meeting-presence-controller.js`
- `AssistOSExplorer/webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/participant-layout-controller.js`
- `AssistOSExplorer/webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/webmeet-media-controller.js`
- `AssistOSExplorer/webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/services/rtc-config.js`
- `AssistOSExplorer/webmeetInfra/*/manifest.json`
- `AssistOSExplorer/webmeetInfra/*/scripts/hooks/preinstall.sh`

External LiveKit references:

- `https://docs.livekit.io/transport/encryption/`
- `https://docs.livekit.io/reference/internals/livekit-sfu/`
- `https://docs.livekit.io/home/self-hosting/distributed/`
- `https://docs.livekit.io/home/self-hosting/egress/`
- `https://docs.livekit.io/home/egress/composite-recording`
