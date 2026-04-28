# DS003 - webAdmin Integration and Loading

The **webAdmin** agent is implemented as a Node.js CLI tool for site owners. It operates in interactive mode only.

## Runtime Launcher: web-admin
- **Script Path**: `webAdmin/src/index.mjs`
- **Type**: Node.js launcher script.
- **Purpose**: Provide a long-running interactive CLI that executes owner requests turn by turn.

## Ploinky Agent Integration
- **Manifest File**: `webAdmin/manifest.json`
- **Purpose**: Declares runtime integration metadata so `webAdmin` can be executed as a Ploinky agent.
- **Enablement Mode**: `webAdmin` must be enabled as a normal workspace agent (non-global). Do not run it through global Explorer-style enablement.
  - Recommended: `ploinky enable agent webAdmin` (or `ploinky enable agent webassist/webAdmin`) and then start workspace normally.
  - If enabled globally, runtime discovery may register an unintended skill set.
- **Environment Contract** (`profiles.default.env`):
  - `SOUL_GATEWAY_API_KEY`: API key used for LLM calls through AchillesAgentLib.
  - `ACHILLES_DEBUG`: Enables AchillesAgentLib debug logging.
- **Webchat Access**: `/webchat?agent=webAdmin`

## CLI Parameters
- `<message>` (positional): Owner message text. In interactive mode it can be omitted at startup and provided turn-by-turn.
- `--session-id <id>` / `--session-id=<id>`: Reuse a specific session id for the interactive process.
- `--data-dir <dir>` / `--data-dir=<dir>`: Override the runtime data directory used for `config/`, `info/`, `profilesInfo/`, `leads/`, and `sessions/`.
- `--agent-root <dir>` / `--agent-root=<dir>`: Override the agent root used by runtime initialization.
  - This changes where default `<repo>/data` is resolved when `--data-dir` is not provided.
  - This changes the runtime root used for agent initialization and runtime file paths.
- `-h` / `--help`: Print CLI usage and exit.
- `--`: Stop option parsing and treat all remaining arguments as positional message text.

## Runtime Mode
### Interactive Mode (default)
- **Behavior**: Starts a chat loop in terminal and keeps the process alive across multiple owner turns.
- **Session Handling**: A sessionId is generated at startup (or provided via `--session-id`) and reused for all turns.
- **Exit Controls**: The interactive loop allows exiting by typing `exit`/`quit`/`:q` or by pressing `Ctrl+C`.
- **Example**: `node webAdmin/src/index.mjs "Arata ultimele leaduri"`

## Library: AchillesAgentLib
- **Mandatory Usage**: Access to LLMs must be through this library.
- **Import Mechanism**: The runtime imports AchillesAgentLib directly from resolved `node_modules`.
- **Loading Logic**:
  - Use direct import syntax: `import { MainAgent, MarkdownDataStore } from "achillesAgentLib";`.
  - Do not use filesystem scanning loaders for webAdmin Achilles resolution.

## Base Agent: MainAgent
- **Functionality**: The runtime uses a single `MainAgent` instance (composition) to manage discovery and execution.

## Skills Discovery and Orchestration
- webAdmin skills under `webAdmin/skills/` are implemented as Achilles **cskills**.
- At startup, `MainAgent` is initialized with `startDir = webAdmin/` and discovers skills from `webAdmin/skills/`.
- During runtime, webAdmin calls `MainAgent.executePrompt(...)`.
- `systemPrompt` is loaded from `webAdmin/src/prompts/admin-flow-system-prompt.mjs`.
- Dynamic context (known leads, profile list, owner/site snapshots, owner message) is appended into the runtime prompt on every turn.
- The sessionId is forwarded to `MainAgent` to isolate multi-user sessions in shared instances.
- Runtime data access is centralized through `webAdmin/src/runtime/dataStore.mjs`.
- The datastore is configured exactly once when `createWebAdminAgent(...)` is initialized (default `<repo>/data`, or CLI `--data-dir` override).
- Runtime modules and skills only consume the configured datastore instance and must not accept per-call datastore overrides.
- Before each orchestration call, webAdmin runs `webAdmin/src/runtime/load-context.mjs` to load profile list, owner info, and website info for the runtime prompt.
- Datastore folder names and section labels are centralized in `webAdmin/src/constants/datastore.mjs` and must be reused across runtime/skills (no hardcoded folder/section literals in business logic).
- Markdown parsing/rendering and section normalization rules (including `*None*` fallback for empty section content) are handled by Achilles `MarkdownDataStore`, not by agent datastore modules.

## CLI Delegation Flow
- The Node.js launcher `webAdmin/src/index.mjs` initializes `WebAdminAgent` and executes conversation turns.
- `WebAdminAgent` initializes one `MainAgent` instance and delegates each turn through `executePrompt(...)`.
- In interactive mode, the launcher calls the runtime repeatedly (one call per turn).
- The runtime expects the orchestrator to return a non-empty response string for each turn.

## Communication Language
- **Input/Output**: Communication with the owner can be in any language.
- **Data Storage**: All file-based information (specs, session details, leads) must be stored in **English**.
