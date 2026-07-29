# Explorer QA WebMeet Room Cleanup Regression

## Status

Verified through the public QA edge on 2026-07-29. Explorer
`8e435976ed120beea49b4b3ff7e4bdf0b24fdd98` added permanent WebMeet room
deletion. Ploinky
`b92b471f3c69a238588f87f9e19679b14869c19f` corrected the private-listener
provenance defect that initially blocked strict LiveKit invalidation inside the
Box. Explorer `cbc6d4e543e5e4497a35797cdb695b02a5e048c9` completed cleanup of
the canonical empty room workspace directory. The final serial acceptance run
passed both required cases and removed all run-scoped data.

## Environment

- Origin: `https://explorer-qa.axiologic.dev`
- Explorer commit: `2e7519bafb539d82464b9eac018171115b40b42a`
- Ploinky commit: `e578b28cb965b3bd52063b4e450c627d6af971a6`
- Deploy workflow run: `30487304813`
- Acceptance run ID: `20260729202710-69947`
- Edge override: `104.21.57.223`

## Reproduction

1. Create a run-scoped administrator and a run-scoped ordinary user through
   Explorer Administration.
2. Sign in as the generated administrator and create a run-scoped WebMeet
   room.
3. Sign in as the generated ordinary user in an isolated browser context.
4. Join both users to the room and exchange messages in both directions.
5. Reopen WebMeet as the generated administrator and attempt to permanently
   remove the run-scoped room.

## Expected

An administrator can permanently delete the test room after the participants
disconnect. The room, chat history, participant state, and other room-owned
records are removed so the run leaves no room-scoped data behind.

## Actual

The room row exposes only **Room settings**. The Lifecycle tab offers
**Archive room**, which intentionally preserves the room and its history.
There is no room-deletion action in the WebMeet UI or `webmeetAgent` MCP tool
inventory. The former smoke helper still targeted a retired
`data-local-action="deleteMeeting"` control and timed out.

The functional evidence before teardown succeeded:

- both generated Explorer principals were distinct and authenticated;
- both browsers joined the same room with distinct LiveKit participant
  identities;
- the owner's message was visible to the member;
- the member's message was visible to the owner.

The test correctly remained failed because required cleanup did not complete.

## Impact

Every strict WebMeet acceptance run either leaks a room and its history or
archives the data instead of cleaning it. Repeated QA runs accumulate
run-scoped artifacts, and a passing release gate cannot honestly claim
teardown safety.

## Required Correction

Provide an authenticated, administrator-only permanent room deletion path.
It must:

1. reject ordinary users and guests;
2. remove the room and all room-owned persistent data;
3. terminate or invalidate active room state safely;
4. expose an explicit, confirmed UI action;
5. update the room list so absence is observable;
6. include regression tests for authorization, complete deletion, and the UI
   contract.

The QA acceptance cleanup must use this path and assert that the exact
run-scoped room no longer appears.

## Implemented Correction

Explorer `8e435976ed120beea49b4b3ff7e4bdf0b24fdd98` adds
`webmeet_room_delete` and an explicit **Delete room** action under
**Room settings → Lifecycle**. The server requires router-derived
administrator authorization, an exact `room_<uuid>` identifier, and literal
`confirmed: true`.

Deletion strictly invalidates the LiveKit room before durable cleanup. Only a
structured LiveKit `not_found` result is accepted as already closed. Generic
route, identity, or control-plane failures preserve the durable room.

After media invalidation, same-filesystem staged moves with rollback remove the
encrypted room record, WebMeet-local resources, room events, and exact
workspace event references. The encrypted record contains participant, chat,
agent, blackboard, and SCRIPTA attachment metadata. Unrelated room data remains
untouched.

Focused authorization, store, lifecycle, and UI verification passed 30/30.
Eight syntax checks and `git diff --check` also passed. The broad WebMeet suite
ran 349 tests: 341 passed, while eight failures reproduced in unchanged
audio-template, SCRIPTA, and missing axi-face vendor-module coverage.

## Follow-up Private Router Regression

The first corrected public-edge run proved both users, both LiveKit
participants, and both chat directions, but its cleanup assertion initially
stopped before confirmation because the browser rendered the warning with
non-breaking spaces. Explorer
`4ed133fd624df2c35242af20662cbcbd9be909a0` made that harness assertion
whitespace-tolerant and retained canonical Explorer principal identifiers in
the evidence artifact.

After confirmation was clicked, the exact room still remained for 45 seconds.
Read-only runtime evidence showed the MCP request was correctly authenticated
as the generated administrator with `confirmed: true`, but strict LiveKit
invalidation failed with:

```text
LiveKit room API failed: {"error":"PRIVATE_INTERFACE_DENIED"}
```

WebMeet correctly failed closed before staging any durable deletion. The
encrypted room record, room-event directory, and room resource directory all
remained intact, and LiveKit received no delete-room call.

The request had passed Ploinky's private wildcard listener, but the Router
subsequently reclassified its host-gateway destination address as unmanaged
and discarded that transport admission. Ploinky
`b92b471f3c69a238588f87f9e19679b14869c19f` now records private provenance
only after listener admission in a module-private `WeakSet`; private HTTP and
WebSocket handlers consume that unforgeable transport-bound provenance.
Same-address sockets that did not pass the private listener remain denied.
Focused private-routing tests passed 14/14 and the full Ploinky unit suite
passed 1,853 tests with two skips and no failures.

## Follow-up Empty Directory Regression

The first successful permanent-deletion audits found no users, documents,
LiveKit rooms, room records, events, jobs, locks, or resource files, but found
three empty run-scoped directory shells under `/workspace/WebMeet`.

The durable delete transaction staged the WebMeet `/data` record, resources,
events, and workspace-event references. The canonical SCRIPTA `folderPath`
under `/workspace/WebMeet`, stored in the encrypted room payload, was not part
of that transaction.

Explorer `cbc6d4e543e5e4497a35797cdb695b02a5e048c9` stages that exact
room-id-bound directory on its own filesystem. It removes the path only when
it is an ordinary empty directory. Symlinks, mismatched paths, non-empty
directories, and unrelated rooms are rejected, and any already staged durable
data is rolled back.

Focused deletion tests passed 8/8. The related deletion, SCRIPTA, store,
remediation, lock, and rollback suite passed 55/55. A final deployed-head run
proved that no directory matching its room title or run ID remained.

## Final QA Verification

| Field | Value |
| --- | --- |
| Clean deploy workflow | `30491591848` |
| Router reconcile workflows | `30493582310`, `30495285398` |
| Explorer revision | `cbc6d4e543e5e4497a35797cdb695b02a5e048c9` |
| Ploinky revision | `b92b471f3c69a238588f87f9e19679b14869c19f` |
| Edge override | `104.21.57.223` |
| Preserved-room repair proof | `20260729213155-81007`, passed |
| Final fresh acceptance run | `20260729222049-93769`, 2 passed, 0 failed |

The preserved failing room was deleted successfully after the Router
reconcile. The targeted proof then recreated the same run-scoped room, joined
two distinct generated Explorer users with distinct LiveKit participant
identities, observed chat in both directions, and permanently deleted the
replacement room.

The mandatory fresh run selected exactly two serial tests. Its OnlyOffice case
created
`/Confidential/My Space/e2e-confidential-20260729222049-93769.doc`, proved
`word`/`.doc` edit mode with autosave enabled, observed the saved state without
clicking Save, reopened the document with its marker persisted, and deleted
the file. Its WebMeet case proved distinct generated administrator and ordinary
user principals, distinct LiveKit identities, and bidirectional chat, then
permanently deleted the room and deleted both generated users.

The authoritative post-run audit found zero matching encrypted user records,
documents, WebMeet records, events, deletion jobs, locks, LiveKit rooms, or
workspace paths. In particular,
`/workspace/WebMeet/e2e-room-20260729222049-93769*` did not exist. Three
empty shells left by runs before `cbc6d4e` were revalidated as exact ordinary
non-symlink empty directories and removed with empty-directory-only operations.
