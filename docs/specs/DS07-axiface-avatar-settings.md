# DS07 - AxiFace Avatar Settings

## Purpose

Explorer exposes AxiFace avatar configuration through the Settings modal. The feature configures the current user's profile avatar and admin-managed AI agent avatars without changing Ploinky global user records.

## Storage

User profile avatar configuration is stored in DPU My Space at `profile/avatar-config.json`. The file stores an envelope with `version`, `enabled`, and normalized AxiFace `config`. The browser reaches that storage only through the protected Explorer avatar settings HTTP service, which reads and writes the current user's profile on the server side with the router-issued invocation context.

AI agent avatar overrides are stored in Explorer workspace state at `.ploinky/explorer-agent-avatar-overrides.json`. The registry stores only admin overrides and enabled flags. The agent list is derived from the workspace manifest, saved overrides for removed agents remain visible as missing entries, and agent manifests may declare a default avatar through a top-level `avatar` object before Explorer falls back to a deterministic generated default.

## Permissions

The avatar settings HTTP service is a protected Explorer service. User identity comes from the router-authenticated Ploinky invocation context, not from request bodies.

Any authenticated user may configure only their own profile avatar through DPU My Space. Admin users may configure AI agent avatars and visibility. Non-admin users may read public agent avatar configuration for rendering but must not mutate agent avatar settings.

## HTTP Contract

`GET /services/explorer/avatar-settings/me` returns the current user's resolved avatar as `{ enabled, config, fallbackLetter, source }` with the same shape mirrored under `avatar` for consumers that want a single grouped object. The resolver is centralized on the server: a saved enabled state and config in DPU take precedence, otherwise Explorer returns a deterministic generated fallback config and the fallback letter derived from the authenticated user.

`PATCH /services/explorer/avatar-settings/me` accepts `{ enabled, config }`, validates the config, and writes the DPU profile document. `GET /services/explorer/avatar-settings/users/:userId` may return another user avatar only when the requested user is safely resolved in the current authenticated session; unresolved or unauthorized users are rejected instead of guessing or reading arbitrary DPU spaces.

## AxiFace Contract

Explorer consumes AxiFace as the separate `AxiFace` workspace repository, not as a copied vendor directory inside Explorer. The public frontend integration surface is `explorer/services/profile-avatar-client.js`; feature code and other agents must import that facade instead of internal avatar modules. The facade loads the Web Component through Explorer's protected `/services/explorer/axi-face/` asset service, which serves files only from `.ploinky/repos/AxiFace` or `AXIFACE_REPO_PATH`. Saved configs are normalized to AxiFace fields and reject unknown fields.

Accepted avatar configs may include generated faces, `src`, `pack-src`, `asset-mode`, emotion, thought display, mode, shape, theme, seed, style, palette, complexity, animation, and listen state. Absolute external asset URLs must use HTTPS; `javascript:`, unsafe `data:`, protocol-relative URLs, and unknown fields are rejected. When `asset-mode="inline"` is requested, Explorer fetches the referenced SVG on the backend and applies the same strict inline SVG sanitization contract before the config is persisted.

## UI Behavior

The Settings modal includes an `Avatar` tab. Profile controls are visible to all authenticated users and include an enabled toggle. Agent controls are visible only to admins. Opening the tab refreshes the current profile and agent data from the backend. If DPU My Space is unavailable, the profile save action is disabled and the user sees a clear persistence error. Previews render live with `<axi-face>` when enabled and fall back to a first-letter avatar when disabled. Saving emits `assistOS:avatar-settings-updated` with the affected scope, and first-party user surfaces invalidate their avatar cache from that event.
