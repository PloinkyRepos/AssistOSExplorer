# AssistOS Explorer Headless Smoke Suite

This package contains the maintainable Playwright smoke suite for Explorer, WebChat, WebMeet, DPU/OnlyOffice, and GitHub plugin paths.

## Quick Start

From this directory:

```bash
npm ci
npm run install:browsers
SMOKE_BASE_URL=http://127.0.0.1:8080 npm test
```

The default local credentials are `admin` / `admin` and `user` / `user`. Override them with:

```bash
SMOKE_USERNAME=admin SMOKE_PASSWORD=admin \
SMOKE_SECONDARY_USERNAME=user SMOKE_SECONDARY_PASSWORD=user \
SMOKE_BASE_URL=https://skills.axiologic.dev \
npm test
```

Artifacts are written outside tracked source by default:

```text
../../.ploinky/test-artifacts/headless-smoke/<run-id>/
```

Playwright traces, screenshots, videos, and JSON reports stay under `tests/smoke/test-results/` and `tests/smoke/playwright-report/`.

## Coverage

Default smoke checks:

- Router auth, dashboard, Explorer shell, and WebChat shell.
- WebChat file and folder uploads through the browser.
- WebChat upload containment evidence from the upload response: `uploads/<sessionId>/...`.
- Session-scoped WebChat `@` file suggestions by comparing two browser contexts.
- WebChat `@open-interpreter` suggestion, selection, and composer highlight.
- WebMeet room creation, two-account join, chat delivery, and cleanup.
- WebMeet `@open-interpreter` suggestion, selection, and composer highlight.

Opt-in checks:

- `SMOKE_OPEN_INTERPRETER=1` waits for real relay responses from Open Interpreter.
- `SMOKE_WEBMEET_MEDIA=1` enables fake camera/microphone and asserts WebRTC stats increase.
- `SMOKE_WEBMEET_SCREEN=1` is reserved for headless screen-share coverage once the runtime environment supports deterministic display capture.
- `SMOKE_ONLYOFFICE=1` enables DPU/OnlyOffice route checks.
- `SMOKE_GITHUB=1` enables GitHub plugin authentication checks.

## Useful Commands

Run only the default non-external suite:

```bash
npm run test:quick
```

Run against production:

```bash
SMOKE_BASE_URL=https://skills.axiologic.dev npm test
```

Run long relay and media checks:

```bash
SMOKE_OPEN_INTERPRETER=1 SMOKE_WEBMEET_MEDIA=1 npm test
```

Allow known browser noise temporarily while triaging:

```bash
SMOKE_ALLOW_BROWSER_ERRORS=1 npm test
```

## Maintenance Rules

- Prefer stable IDs and data attributes already present in the UI.
- Add a helper under `lib/` before duplicating a flow across specs.
- Keep secret values out of screenshots, traces, console logs, and test annotations.
- External provider checks must stay opt-in unless the repository owns all required credentials and runtime configuration.
- Tests that create rooms, uploads, users, branches, or files must use `SMOKE_RUN_ID` in names and clean up when the UI exposes cleanup.
