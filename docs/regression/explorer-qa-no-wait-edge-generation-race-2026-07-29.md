# Explorer QA No-Wait Edge Generation Race

## Status

Confirmed on the clean `ploinky-proxy` QA deployment on 2026-07-29. The
Ploinky correction is published as
`00f0adfba3c4ad4825ae262a5b7b1ee9172dfd0d`. Clean deployment run
`30484668139` verified that all 16 agents, including LiveKit, reached running
without manual intervention. The QA acceptance suite remains blocked only by
the separately recorded public Administration proof correction and its
required redeployment.

## Environment

| Field | Value |
| --- | --- |
| Origin | `https://explorer-qa.axiologic.dev` |
| Explorer revision | `024e034700eb2b17d754084627c570524dc18915` |
| Ploinky revision | `95ed406c34aafb92fd3c9eff37844a84727e6e05` |
| Deployment | Fresh graph after the QA workspace, volumes, Box, DNS, and managed tunnel were removed |
| Affected agent | LiveKit, the final serialized cold start |

## Expected

Every no-wait worker should tolerate a bounded edge-generation transition,
activate its route against the current immutable generation, and either reach a
running terminal state or report a durable application failure. Once the final
agent is running, the Ploinky-managed Cloudflare connector should settle at
`ready/running`.

## Actual

Fifteen of sixteen tracked agents reached running. During LiveKit's cold start,
another route-generation apply made the worker's captured generation inactive.
The worker exited with:

```text
EDGE_GENERATION_INACTIVE
```

The watchdog then intentionally deferred restarting the failed worker while the
workspace-start lease remained active. No component took responsibility for
retrying the transient generation conflict, so the graph remained at 15/16 and
the acceptance suite could not safely start.

The earlier publication `error/stopped` observation was not this defect: the
Cloudflare reconciler recovered that transition as designed. This defect is the
loss of the final no-wait worker after that recovery.

## Impact

LiveKit and the WebMeet dependency chain are not reliably ready after a clean
deployment. Running the two-user room and chat acceptance case against this
state would produce an infrastructure false failure, and manually starting
LiveKit would hide the clean-deployment regression.

## Correction Boundary

The Ploinky lifecycle should retry only the transient inactive-generation
outcome within a finite budget. Each attempt must re-read the active immutable
generation and preserve the existing fail-closed route checks, runtime identity
validation, cancellation behavior, and durable failure reporting. The fix must
not weaken edge-generation validation, extend retries indefinitely, or depend
on a manual one-off agent start.

Regression coverage must reproduce a generation becoming inactive between
worker startup and route activation, prove that the next active generation is
used, and prove that repeated conflicts still terminate within the retry
budget.

## Correction

The no-wait host-runtime launch now retries only a pre-launch
`EDGE_GENERATION_INACTIVE` result. It releases the edge apply lock before
backoff, then recaptures a selector for the same immutable generation while
requiring the same staged runtime identity. Every attempt validates exact
selector stability while holding the lock, and runtime creation is never
replayed.

Focused regression coverage passes 59/59 cases. It proves same-generation
recovery and exactly-once launch while rejecting a replacement generation,
selector drift within the lock, `EDGE_GENERATION_BUSY`, staged-identity drift,
and an inactive-coded error after launch begins. The complete Node suite passes
1,844 tests with 2 intentional skips and no failures.

## Verification Required

After the Ploinky correction is committed and pushed to `ploinky-proxy`:

1. Destroy QA using the exact runtime that owns the deployed generation.
2. Deploy the current `ploinky-proxy` heads into an empty QA workspace.
3. Observe all 16 tracked agents reach running without manual intervention.
4. Require a stable connector identity and repeated successful public edge
   probes.
5. Run both headless Explorer QA acceptance cases.
