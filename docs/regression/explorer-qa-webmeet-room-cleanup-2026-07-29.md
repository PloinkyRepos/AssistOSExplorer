# Explorer QA WebMeet Room Cleanup Regression

## Status

Corrected in Explorer
`8e435976ed120beea49b4b3ff7e4bdf0b24fdd98`. The two-user room and chat
behavior passed on the clean QA deployment, but the release gate remains
pending until a clean redeployment proves permanent cleanup through the public
edge.

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
