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
- Manifest guest access for the embedded chat route and guest-callable MCP tool policy.

## Headless Smoke
- `tests/smoke/specs/15-webassist-guest.spec.mjs` loads the embedded chat without login and initializes `/webAssist/mcp` from a clean browser context.

## Fixtures
Fixtures live under `tests/fixtures/seed-data/sites/demo-site/` and match the production folder layout.
