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
- `prepare-wac` delegating `{ prompt, projectDir, model }` to `opencodeAgent.execute-task` without passing raw `wacData`, reporting `.aku/` as a child of the site project directory, instructing `create-akus` to fetch `siteMap`, and rewriting local `siteMap` URLs for container prompt access.
- `prepare-wac` WAC caching in `<dataRoot>/wac-cache.json`: first build writes cache, unchanged WAC plus existing `.aku/aku.json` skips OpenCode, changed WAC rebuilds, missing AKU manifest rebuilds, and corrupt cache files are treated as cache misses.
- Local WAC fixture consistency: `tests/localServer/WAC.json` must mirror `tests/localServer/profiles/*.md` exactly and list `tests/localServer/assistos-info/*.md` as absolute local server URLs.
- Manifest guest access for the embedded chat route and guest-callable MCP tool policy.

## Headless Smoke
- `tests/smoke/specs/15-webassist-guest.spec.mjs` loads the embedded chat without login and initializes `/webAssist/mcp` from a clean browser context.

## Fixtures
Fixtures live under `tests/fixtures/seed-data/sites/demo-site/` and match the production folder layout.
