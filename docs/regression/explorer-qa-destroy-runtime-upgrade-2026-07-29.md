# Explorer QA Destroy Runtime Upgrade Failure

## Status

Confirmed during the 2026-07-29 from-scratch redeployment. The deployment task
is correcting the destroy workflow and recovering the partially stopped QA
Box.

## Expected

The destructive QA workflow should remove the Ploinky-managed Cloudflare
publication, stop and delete the deployed application graph and Box, purge the
QA volumes and identity directory, and leave a host that can be redeployed from
an empty state.

## Actual

The workflow removed the managed Cloudflare publication and then advanced the
Box to the current `ploinky-proxy` runtime before completing teardown. The new
runtime correctly rejected the active routing generation because it had been
compiled by the older deployed runtime. Destroy therefore stopped partway
through and left a partially stopped Box instead of an empty QA host.

## Root Cause

Destroy treated teardown as a routing-state migration. A destructive workflow
must not change the runtime responsible for interpreting and deleting its
active generation before that generation is removed.

## Fix Contract

Teardown must use the exact Ploinky runtime recorded for the deployed active
generation. After that runtime has cleanly removed Cloudflare ownership,
routing state, application containers, and the Box, the subsequent deploy may
resolve the latest `ploinky-proxy` branch and create a new generation.

The regression must cover a branch advancement between deploy and destroy and
prove that:

| Requirement | Expected evidence |
| --- | --- |
| Runtime selection | Destroy resolves the runtime that created the active generation |
| Cloudflare cleanup | The owned DNS record and tunnel are removed |
| Host cleanup | QA containers, volumes, and identity directory are absent |
| Upgrade boundary | The next deploy, not destroy, advances to the new branch head |

The release gate remains blocked until a corrected destroy completes, a fresh
deploy succeeds, and both public headless QA acceptance tests pass.
