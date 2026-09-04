---
title: DS002-runtime-v5
summary: Defines control and editor route access, service readiness, topology generations, and managed storage.
---

# DS002 Runtime V5

## Introduction

OnlyOffice [Runtime-v5](wiki.html#definition-runtime-v5) runs the pinned image behind two [Router](wiki.html#definition-router) targets and a manifest-defined persistent storage layout.

## Core Content

The control route at /base-agent-additional-server/onlyOffice/7000/control/* must require authenticated access. The editor route at /base-agent-additional-server/onlyOffice/8080/* must be public only for the declared editor transport. The manifest must not create a physical-host publication.

Startup readiness must verify the exact configured nginx alias, the distinct byte-identical 105:107 and 0644 copies, the [::1]:8000 DocService listener, callback storage, and the expected [DocumentServer support services](wiki.html#definition-support-services), addresses, and process ownership. Recurring liveness may use bounded loopback HTTP checks after activation.

Controlled shutdown must stop new control and editor admission, force-save each writable session whose source document DocumentServer actually requested, and await its durable callback acknowledgement before stopping DocumentServer. Issued control configurations that DocumentServer never consumed are not live editors and must not enter the callback wait set.

After durable drain, while the proxy and DocumentServer process group remain alive, the agent must send `PUT http://[::1]:8000/internal/cluster/inactive` to the declared IPv6-loopback DocService listener. DocumentServer sends its terminal shutdown notification and closes upgraded editor sockets, including read-only sessions. The agent must observe every upgraded socket close before any remaining HTTP connections are destroyed or any process is signalled. Native delivery has at most two seconds and shares the original application drain deadline of at most thirty seconds; exhausted time cannot be renewed between phases. The native HTTP response may wait at least thirty seconds, so it is not the delivery acknowledgement: once editor sockets close, the agent cancels and settles that outstanding request. With no upgraded editors the native delivery phase needs no request. Request errors, non-success responses, or missing socket closure fail shutdown while leaving callback storage and DocumentServer alive and new admission stopped.

The wrapper and its foreground helpers must run in a dedicated process group so one SIGTERM reaches the complete foreground tree only after durable drain and graceful editor disconnect. Its additional notification to the same exact IPv6-loopback endpoint keeps a two-second total timeout and must not extend the agent beyond Ploinky's clean-exit bound.

Each session must resolve the current immutable [topology generation](wiki.html#definition-topology-generation) and store an atomic guarded 0600 state file under the persistent work directory. Bundled service data remains image-owned; only exact guarded service paths may receive ownership or mode preparation.

DocumentServer startup fixes `PLUGINS_ENABLED=false` to prevent the upstream background plugin updater from changing the pinned asset bundle. Before an editor becomes ready in Explorer, its versioned immutable status SVG is loaded while the owner route is active. The browser may then render native disconnect warnings from cache after route retirement without opening inactive routes.

## Conclusion

The runtime contract makes service activation and session generation explicit and fails closed when the expected pinned topology is not present.
