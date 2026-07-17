# Deploy Explorer with Runtime Contract v5

The repository no longer contains an SSH workflow that mutates a remote
workspace. Deployment is intentionally operator-controlled until dedicated v5
test resources and credentials are supplied.

## Required sequence

1. Back up application data, then complete the destructive credential/state
   prerequisites documented by Ploinky operations.
2. Build or pull the pinned multi-architecture box and dependency images.
3. Configure either explicit local-only mode or a complete existing-tunnel
   Cloudflare configuration. Never create a quick or new tunnel.
4. Configure the literal public media IPv4 and external relay service.
5. Recreate the box explicitly under runtime contract v5.
6. Inspect the real outer container and prove its normalized bindings are
   exactly loopback Router TCP and wildcard LiveKit UDP `7882`.
7. Start the full Explorer graph and validate in-box listener ownership.
8. Run the real-browser OnlyOffice, Umami, GPTResearcher, and WebMeet gates.

The WebMeet screen gate is:

```bash
cd tests/smoke
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_WEBMEET_MEDIA=1 \
SMOKE_WEBMEET_SCREEN=1 \
SMOKE_TEST_TIMEOUT_MS=240000 \
npm test -- --headed --project=chromium specs/30-webmeet-room-chat.spec.mjs
```

This command requires two distinct authenticated accounts. On Linux without a
display, the runner creates a deterministic Xvfb display. Missing accounts,
media, or real infrastructure are hard failures while the screen flag is set.
The local gate removes TURN and requires both browsers to use active non-relay
UDP `7882` pairs during each ScreenShare direction. Exact configured-public-IP
selection is intentionally reserved for the distinct-network native x64/arm64
matrix, which also rejects `7881` and private/discovered alternatives.

Cloudflare, external relay, cross-network, native x64, and native arm64 gates
must use dedicated test resources. A missing prerequisite is reported as
BLOCKED with the reproducible command; it is never treated as a pass.
