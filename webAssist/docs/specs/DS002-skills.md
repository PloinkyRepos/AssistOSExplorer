# DS002 - webAssist Skills and Behavioral Logic

`webAssist` uses only the `webassist-*` skill set. There are no legacy visitor-runtime skill names.

## Skill Catalog
- `webassist-site-context`: reads approved site info, profiles, owner rules, and policy.
- `webassist-session`: creates and updates site-scoped session records.
- `webassist-match`: validates target profile match and mandatory conditions.
- `webassist-lead`: creates or updates consented lead records.

## Orchestration
Visitor turn orchestration is driven by the system prompt (`visitor-flow-system-prompt.mjs`) through the MainAgent instance. No separate orchestration skill is used.

## MCP Tools
- `register-events`: appends site-scoped events (visit, chat-start, message, consent, lead-notification) to `visits/events.md`.

## Runtime Modules
- `load-context` loads site-scoped context before orchestration.
- `update-session` persists session profile sections and appends final user/agent history.
- `dataStore` resolves `<dataRoot>/sites/<siteId>/` and constructs `MarkdownDataStore`.

## Behavioral Rules
- `siteId` is mandatory and isolates all reads/writes.
- The assistant answers only from approved website information and the current visitor conversation.
- Session state is persisted through `webassist-session` before final response.
- Leads are persisted only through `webassist-lead`.
- Consent is strict: no lead file is created without explicit follow-up storage consent.
