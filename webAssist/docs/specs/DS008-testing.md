# DS008 - webAssist Testing

## Runner
- `node tests/runAll.mjs`

## Covered Areas
- Agent turn execution through `createWebAssistAgent(...).handleMessage({ siteId, sessionId, message })`.
- Site-scoped datastore resolution at `<dataRoot>/sites/<siteId>/`.
- Session profile and history persistence in separate files.
- `load-context` loading `info/`, `profiles/`, owner rules, policy, current session, and current lead.
- `webassist-lead` deterministic lead file updates.
- `register-events` appends Markdown event records to `visits/events.md`.
- `web_cli_history` requiring `siteId`.

## Fixtures
Fixtures live under `tests/fixtures/seed-data/sites/demo-site/` and match the production folder layout.
