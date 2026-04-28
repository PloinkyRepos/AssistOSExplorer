# DS001 - webAssist Data Structure and Session Management

The `data/` folder is the persistent storage for the webAssist agent. It is excluded from version control via `.gitignore`.

Runtime note:
- By default, `data/` is resolved at repository root (`<repo>/data`).
- `--data-dir` can override this location explicitly.
- `--agent-root` changes the runtime root whose parent is used for default `<repo>/data` resolution.
- Persistence is implemented through `MarkdownDataStore` from AchillesAgentLib.
- Folder/section identifiers used by datastore calls are centralized in `webAssist/src/constants/datastore.mjs`.

## Data Subfolders
- **config/**: Contains `owner.md` or similar files with site owner contact details and calendar/meeting links.
- **info/**: General knowledge base for the agent. Markdown files containing details about the user, company, or site services.
- **profilesInfo/**: Contains `ProfileName.md` files. Each file defines the characteristics, interests, and qualifying criteria for a specific user type (e.g., "Developer", "Enterprise Client").
- **leads/**: Stores contact information and profiling data for valuable prospects identified during conversations.
- **sessions/**: Stores the state of active and past interactions.

## Session File Specification (split files)
Each session uses two files in `sessions/`:
- `{sessionId}-profile.md`
- `{sessionId}-history.md`

### Session ID Lifecycle
- `sessionId` can be provided explicitly by the caller.
- If omitted at CLI launcher level, `webAssist/src/index.mjs` generates it automatically.
- In interactive CLI mode, the same generated/provided `sessionId` is reused for all turns until the process exits.
- In MCP mode (`-mcp`), one request uses one `sessionId` and exits.

### Profile file (`{sessionId}-profile.md`)
#### 1. Profile
Contains a list of filenames from `profilesInfo/` that are currently considered relevant to this session. 
- **Initialization**: Can start with multiple likely profiles.
- **Evolution**: The list is updated/narrowed down as more information is gathered from the user.

#### 2. Profile Details
A structured list of important facts and conversational state extracted from the interaction.

This section is the continuity memory source loaded by runtime for future turns. It must include:
- stable visitor facts (industry, intent, constraints, readiness);
- concise conversation-memory notes authored by orchestrator in English, including:
  - what the agent asked,
  - what the user answered,
  - pending clarifications and qualification-relevant discussed aspects.

#### 3. Contact Information
Structured key-value contact memory for the current visitor session.

Schema:
- no hardcoded key list; orchestrator stores explicit key-value contact facts provided by the visitor.
- visitor full name is mandatory to request during qualification; when missing, this is recorded in `Profile Details`.

Contact rule:
- keep at least one direct contact channel when available (for example email, phone, social profile, or equivalent);
- only explicit user-provided values are persisted.

### History file (`{sessionId}-history.md`)
#### 1. History
A chronological log of the interaction:
- **User**: [Input text]
- **Agent**: [Response text]

History remains persisted for audit and admin-side analysis, but it is not loaded into webAssist orchestration context during runtime turns.

## Lead File Lookup Rule
- Lead files are deterministic per session: `{sessionId}-lead.md` in `leads/`.
- Runtime `load-context` resolves this file and exposes `currentLead` in the runtime prompt payload.
- Meeting scheduling decisions must rely on `currentLead.exists` rather than profile-detail markers.
