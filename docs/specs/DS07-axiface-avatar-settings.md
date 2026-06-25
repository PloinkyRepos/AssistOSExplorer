# DS07 - AxiFace Avatar Settings

## Purpose

Explorer exposes AxiFace avatar configuration through the Settings modal. The feature configures the current user's profile avatar and admin-managed AI agent avatars without changing Ploinky global user records.

## Storage

User profile avatar configuration is stored in browser `localStorage` under `assistOS.profileAvatar.settings`. The value stores an envelope with `enabled`, normalized AxiFace `config`, and `updatedAt`. Profile avatar persistence is local to the browser and does not use DPU My Space.

AI agent avatar overrides are stored in Explorer workspace state at `.ploinky/explorer-agent-avatar-overrides.json`. The registry stores only admin overrides and enabled flags. The agent list is derived from the workspace manifest, saved overrides for removed agents remain visible as missing entries, and agent manifests may declare a default avatar through a top-level `avatar` object before Explorer falls back to a deterministic generated default.

## Permissions

The avatar settings HTTP service is a protected Explorer service for admin-managed AI agent avatars. User identity comes from the router-authenticated Ploinky invocation context, not from request bodies.

Any browser user may configure their own profile avatar locally. Admin users may configure AI agent avatars and visibility through the Explorer service. Non-admin users may read public agent avatar configuration for rendering but must not mutate agent avatar settings.

## HTTP Contract

Profile avatar read/write does not use an HTTP contract. `explorer/services/profile-avatar-client.js` reads and writes the local browser profile avatar and broadcasts `assistOS:avatar-settings-updated`.

`GET /services/explorer/avatar-settings/agents` returns the AI agent avatar list. `PATCH /services/explorer/avatar-settings/agents/:agentId` updates an admin-managed agent avatar, and `PATCH /services/explorer/avatar-settings/agents/:agentId/visibility` updates its enabled state.

## AxiFace Contract

Explorer consumes AxiFace as a separate static asset checkout, not as a Ploinky agent repo. Explorer preinstall installs it directly under `explorer/shared/vendor/axi-face` unless `AXIFACE_REPO_PATH` points to an explicit checkout. The public frontend integration surface is `explorer/services/profile-avatar-client.js`; feature code and other agents must import that facade instead of internal avatar modules. The facade loads the Web Component through Explorer's public `/explorer/shared/vendor/axi-face/` assets, covered by the whitelisted `/shared/*` route. Saved configs are normalized to AxiFace fields and reject unknown fields.

Accepted avatar configs may include generated faces, `src`, `pack-src`, `asset-mode`, emotion, thought display, mode, shape, theme, seed, style, palette, complexity, animation, listen state, and explicit `sourceMode`. `sourceMode` is persisted as `generated | pack | svg` in profile storage and WebMeet browser-local override storage so rendering and UI rehydration preserve the user's last selected source even when `generated`, `src`, and `pack-src` alone would be ambiguous. Absolute external asset URLs must use HTTPS; `javascript:`, unsafe `data:`, protocol-relative URLs, and unknown fields are rejected. When `asset-mode="inline"` is requested, Explorer fetches the referenced SVG on the backend and applies the same strict inline SVG sanitization contract before the config is persisted.

The browser UI treats avatar source as an explicit view model concept with exactly one active source mode: `generated`, `pack`, or `svg`. Switching modes clears conflicting fields deterministically. Generated mode clears `src` and `packSrc` and sets `generated=true`; pack mode clears `src`, requires `packSrc`, and sets `generated=false`; SVG mode clears `packSrc`, preserves `src`, and sets `generated=false`. Source-backed avatars preserve the colors and paths from the selected SVG or pack instead of applying generated face palettes. Generated AxiFace faces render as schematic foreground artwork without a filled background tile or palette-filled face/body shapes, so the surrounding card or panel background remains visible instead of adding a blue generated backdrop.

The AxiFace asset checkout exposes `GET /explorer/shared/vendor/axi-face/packs/index.json`, which is generated from real `packs/*/manifest.json` files in the AxiFace repository. Frontend selectors must use that index rather than hardcoded WebMeet-only pack values.

## UI Behavior

The Settings modal includes an `Avatar` tab. The tab uses the shared `shared/ui/avatar-settings-form` WebSkel component for both `My profile avatar` and admin-only `AI agent avatars` panels. The component is presentational plus draft-normalization only: it receives AxiFace packs, generated styles, generated palettes, and the current value from the host, emits normalized draft changes, and does not perform persistence.

Profile controls are visible to all users and include an enabled toggle. Agent controls are visible only to admins. Opening the tab refreshes the current local profile, agent data, generated style metadata, generated palette metadata, and pack metadata. Previews render live with `<axi-face>` when enabled and fall back to a first-letter avatar when disabled. Saving emits `assistOS:avatar-settings-updated` with the affected scope, and first-party user surfaces invalidate their avatar cache from that event. Explorer may expose `seed` for generated avatars as an advanced deterministic control, but WebMeet settings hide that field while still preserving the stored seed in the underlying config.

WebMeet keeps the existing avatar precedence order: current WebMeet override first, then saved profile avatar, then fallback initial. The active local avatar must be resolved once before the participant card renders: if a browser-local WebMeet override exists it is seeded into the local room avatar state before the first room-card render, otherwise the saved profile avatar is used, and only then does the initial fallback apply. Media-only room resyncs (microphone, camera, screen share, active-speaker changes) must preserve that resolved avatar and must not swap between profile and override sources. WebMeet settings open in the standard application modal shell (`modal-header` / `modal-body` / `modal-footer`) instead of a custom in-panel chrome so the presentation stays aligned with the rest of the UI. The shell stays dimensionally stable when switching between `Audio & video` and `Avatar`: the header close button is the only generic dismiss control, while the footer swaps only the tab-specific action group so tab changes do not resize or flicker the modal. Applying a WebMeet avatar override must publish immediately for the current participant inside the active room and through the remote participant projection, then close the settings panel so the user returns to the room with the new avatar already active. The WebMeet quick menu exposes fast preset actions and an `Avatar source` selector so users can switch source mode without opening the full form. Its second-level submenu is source-aware: generated avatars list generated styles, AxiFace pack avatars list available packs, and SVG avatars do not pretend to offer generated-style shortcuts.
