# DS001 - webAssist Data Structure and Session Management

`webAssist` stores all operational data under a site-scoped data root. There is no single-site storage contract.

## Data Root
- Default root: `path.join(process.env.PLOINKY_WORKSPACE_ROOT, "webassist-data")`.
- `PLOINKY_WORKSPACE_ROOT` is required in agent runtime environments.
- The default `webassist-data` directory must already exist; webAssist fails fast when it is missing.
- CLI/MCP override: `--data-dir <dir>`.
- Site root: `<dataRoot>/sites/<siteId>/`.
- `siteId` is required for every runtime, CLI, MCP, and embedded chat operation.

## Site Folders
- `config/owner.md`: owner contact rules and routes that may be disclosed after lead creation.
- `config/policy.md`: visitor notice, retention settings, lead statuses, and disclosure policy.
- `info/`: approved website, organization, service, project, and opportunity information.
- `profiles/`: target visitor profile files.
- `sessions/`: active visitor records, two files per session:
  - `<sessionId>-profile.md` — profile details and contact information.
  - `<sessionId>-history.md` — full user/agent conversation transcript.
- `leads/`: active lead records, one `<sessionId>-lead.md` file per qualified visitor.
- `visits/`: visit, chat, match, and lead event records used for statistics.
- `archive/sessions/` and `archive/leads/`: archived records excluding from active operations.
- `.aku/`: site-specific Agentic Knowledge Units memory.

## Session Profile File
Each session profile uses `sessions/<sessionId>-profile.md`.

Required sections:
- `Profile Details`
- `Contact Information`

This file is written by `webassist-session` skill and read by `loadContext` for session state.

## Session History File
Each session history uses `sessions/<sessionId>-history.md`.

Required sections:
- `History`

This file is appended automatically by the runtime after each visitor turn. It is not modified by `webassist-session`.

## Lead File
Each lead uses `leads/<sessionId>-lead.md`.

Required sections:
- `Lead Info`
- `Match Explanation`
- `Contact Info`
- `Summary`

Lead creation requires target profile match, mandatory conditions, and explicit contact information.
