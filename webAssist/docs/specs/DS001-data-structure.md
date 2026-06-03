# DS001 - webAssist Data Structure and Session Management

`webAssist` stores all operational data under a site-scoped data root. There is no single-site storage contract.

## Data Root
- Default root: `path.join(process.cwd(), "data")`.
- CLI/MCP override: `--data-dir <dir>`.
- Site root: `<dataRoot>/sites/<siteId>/`.
- `siteId` is required for every runtime, CLI, MCP, and embedded chat operation.

## Site Folders
- `config/owner.md`: owner contact rules and routes that may be disclosed after lead creation.
- `config/policy.md`: visitor notice, consent rule, retention settings, lead statuses, and disclosure policy.
- `info/`: approved website, organization, service, project, and opportunity information.
- `profiles/`: target visitor profile files.
- `sessions/`: active visitor conversations, one `<sessionId>-history.md` file per session.
- `leads/`: active lead records, one `<sessionId>-lead.md` file per qualified consented visitor.
- `visits/`: visit, chat, match, and lead event records used for statistics.
- `archive/sessions/` and `archive/leads/`: archived records excluded from active operations.
- `.aku/`: site-specific Agentic Knowledge Units memory.

## Session File
Each session uses one file: `sessions/<sessionId>-history.md`.

Required sections:
- `Target Profiles`
- `Visitor Profile Summary`
- `Profile Details`
- `Contact Information`
- `Consent`
- `History`

`History` stores the full user/agent transcript. Runtime context injects only the latest bounded history excerpt.

## Lead File
Each lead uses `leads/<sessionId>-lead.md`.

Required sections:
- `Lead Info`
- `Match Explanation`
- `Contact Info`
- `Consent`
- `Contact Route`
- `Summary`

Lead creation requires target profile match, mandatory conditions, explicit contact information, and explicit consent.
