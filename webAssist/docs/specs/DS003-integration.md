# DS003 - webAssist Integration and Loading

The **webAssist** agent is implemented as a Node.js CLI tool with a single `sessionId`.

## Runtime Launcher: web-assist
- **Script Path**: `webAssist/src/index.mjs`
- **Type**: Node.js launcher script.
- **Purpose**: Provide a user-friendly CLI entrypoint for interactive and MCP single-shot execution.

## Ploinky Agent Integration
- **Manifest File**: `webAssist/manifest.json`
- **Purpose**: Declares runtime integration metadata so `webAssist` can be executed as a Ploinky agent.
- **Enablement Mode**: `webAssist` and `webAdmin` must be enabled as normal workspace agents (non-global). Do not run them through global Explorer-style enablement.
  - Recommended: `ploinky enable agent webAssist` and `ploinky enable agent webAdmin` (or repository-qualified forms), then start workspace normally.
  - If enabled globally, runtime discovery may register an unintended skill set.
- **Environment Contract** (`profiles.default.env`):
  - `SOUL_GATEWAY_API_KEY`: API key used for LLM calls through AchillesAgentLib.
  - `ACHILLES_DEBUG`: Enables AchillesAgentLib debug logging.

## MCP Contract Integration
- **Configuration File**: `webAssist/mcp-config.json`
- **Tool Entries**:
  - `web_cli_chat`: executes one webAssist conversational turn (`/code/src/index.mjs`) with command args `['-mcp']`.
  - `web_cli_history`: returns parsed persisted history for a given `sessionId` (`/code/src/mcp/get-session-history.mjs`).
- **Container Path Note**: Ploinky mounts agent code at `/code` inside the runtime container, so repo path `webAssist/src/...` maps to container path `/code/src/...` for MCP execution.
- **Execution Mode**: MCP requests are routed as single-shot invocations equivalent to CLI `-mcp` behavior.
- **Input Parameters**: MCP input schema mirrors CLI runtime parameters:
  - `message` ↔ positional `<message>`
  - `sessionId` ↔ `--session-id`
  - `json` ↔ `--json`
  - `dataDir` ↔ `--data-dir`
  - `agentRoot` ↔ `--agent-root`
- **History MCP Input Parameters** (`web_cli_history`):
  - `sessionId` (required)
  - `dataDir` (optional)
  - `agentRoot` (optional)
- **Browser MCP Invocation**: UI clients call `/mcps/webAssist/mcp` and execute tools `web_cli_chat` and `web_cli_history`; browser clients persist `sessionId` in `localStorage` for cross-tab continuity.
- **Session Ownership Rule (plugin MCP)**: when client omits `sessionId` on first `web_cli_chat` call, server generates one and returns it; client persists it to `localStorage` and all open tabs in the same browser reuse that `sessionId`.
- **MCP Chat Output Contract** (`web_cli_chat`): returns compact JSON object with exactly:
  - `sessionId` (string)
  - `message` (string)
- **MCP Mode Rule (chat tool)**: `webAssist/src/index.mjs` enters MCP mode only when `-mcp` flag is present. MCP envelope payload from stdin is parsed only inside that explicit mode.

## CLI Parameters
- `<message>` (positional): User message text. In interactive mode it can be omitted at startup and provided turn-by-turn.
- `-mcp`: Run single-shot mode (one request, then exit).
- `--session-id <id>` / `--session-id=<id>`: Reuse a specific session id.
- `--json`: Print JSON output from runtime instead of plain text response.
- `--data-dir <dir>` / `--data-dir=<dir>`: Override the runtime data directory used for `config/`, `info/`, `profilesInfo/`, `leads/`, and `sessions/`.
- `--agent-root <dir>` / `--agent-root=<dir>`: Override the agent root used by runtime initialization.
  - This changes where default `<repo>/data` is resolved when `--data-dir` is not provided.
  - This changes the runtime root used for agent initialization and runtime file paths.
- `-h` / `--help`: Print CLI usage and exit.
- `--`: Stop option parsing and treat all remaining arguments as positional message text.

MCP input note:
- In `-mcp` mode, if `<message>` is omitted and stdin is piped, the launcher reads the message from stdin.

## Runtime Modes
### 1) Interactive Mode (default)
- **Behavior**: Starts a chat loop in terminal and keeps the process alive across multiple user turns.
- **Session Handling**:
  - If `--session-id` is provided, it must be reused for all turns in that process.
  - If `--session-id` is missing, `web-assist` must generate one automatically and reuse it for the whole interactive session.
- **Persistence**: Every turn updates two files:
  - `{resolvedDataDir}/sessions/{sessionId}-profile.md`
  - `{resolvedDataDir}/sessions/{sessionId}-history.md`
- **Exit Controls**: The interactive loop must allow exiting by typing `exit` or by pressing `Ctrl+C`.
- **Example**: `node webAssist/src/index.mjs "Hello I'm interested in your API"`

### 2) MCP Mode (`-mcp` flag)
- **Behavior**: Executes exactly one user request and then exits.
- **Session Handling**:
  - Accepts optional `--session-id`.
  - If missing, `web-assist` must generate one automatically for that single call.
- **Additional Parameters**: Supports optional `--data-dir` and `--agent-root` with the same semantics as interactive mode.
- **Process Lifecycle**: After returning the response, all spawned subprocesses must terminate and control returns to the caller.
- **Example**: `node webAssist/src/index.mjs -mcp "Hello I'm interested in your API"`

## Library: AchillesAgentLib
- **Mandatory Usage**: Access to LLMs must be through this library.
- **Import Mechanism**: The runtime imports AchillesAgentLib directly from resolved `node_modules`.
- **Loading Logic**:
  - Use direct import syntax: `import { MainAgent, MarkdownDataStore } from "achillesAgentLib";`.
  - Do not use filesystem scanning loaders for webAssist Achilles resolution.

## Base Class: MainAgent
- **Functionality**: The runtime uses a single `MainAgent` instance (composition) to manage discovery and execution.

## cskill Discovery and Execution
- webAssist skills under `webAssist/skills/` are implemented as Achilles **cskills**.
- At startup, `MainAgent` is initialized with `startDir = webAssist/` and discovers cskills from `webAssist/skills/`.
- During runtime, webAssist calls `MainAgent.executePrompt(...)`.
- `systemPrompt` is loaded from `webAssist/src/prompts/visitor-flow-system-prompt.mjs` and remains static per session.
- Dynamic context (`sessionProfile`, `currentLead`, site/profile snapshots) is appended into the runtime prompt together with `User message` on every turn.

## Runtime Pre/Post Modules
- Before orchestration, webAssist runs runtime module `load-context` from `webAssist/src/runtime/load-context.mjs`.
- This module returns dynamic context values used by the runtime prompt.
- Session persistence is split:
  - `update-session-profile` cskill invokes runtime `updateSessionProfile` for profile memory.
  - runtime invokes `appendSessionTurn` automatically after final answer for dialogue history.
- Runtime data access is centralized through `webAssist/src/runtime/dataStore.mjs`.
- The datastore is configured exactly once when `createWebAssistAgent(...)` is initialized (default `<repo>/data`, or CLI `--data-dir` override).
- Runtime modules and skills only consume the configured datastore instance and must not accept per-call datastore overrides.
- Datastore names and section labels are centralized in `webAssist/src/constants/datastore.mjs` and must be reused across runtime/skills (no hardcoded folder/section literals in business logic).
- Markdown parsing/rendering and section normalization rules (including `*None*` fallback for empty section content) are handled by Achilles `MarkdownDataStore`, not by agent datastore modules.

## CLI Delegation Flow
- The Node.js launcher `webAssist/src/index.mjs` initializes `WebAssistAgent` and executes conversation turns.
- `WebAssistAgent` initializes one `MainAgent` instance and delegates each turn through `executePrompt(...)`.
- In interactive mode, the launcher calls the runtime repeatedly (one call per turn) while preserving the same `sessionId`.
- In MCP mode, the launcher performs a single runtime call and exits.
- The sessionId is forwarded to `MainAgent` to isolate multi-user sessions in a shared agent instance.

## Communication Language
- **Input/Output**: Communication with the visitor can be in any language.
- **Data Storage**: All file-based information (specs, session details, leads) must be stored in **English**.
