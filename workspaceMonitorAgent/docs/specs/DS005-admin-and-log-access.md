---
title: DS005-admin-and-log-access
summary: Defines administrator authorization, settings validation, Ploinky log operations, rotation, and cleanup.
---

# DS005 Admin And Log Access

## Introduction

Workspace Monitor exposes operational controls only to a verified administrator.

## Core Content

The tool wrapper must resolve the invocation actor from Ploinky's authenticated metadata before reading input arguments. The administrator check may accept an admin role, the normalized local administrator username or user id, or the normalized local administrator principal id as implemented by assertAdministrator. A client-declared actor or role without verified invocation metadata must not be sufficient.

Settings must default to workspace CPU 80 percent, workspace memory 4 GiB, Router CPU 80 percent, Router memory 512 MiB, and seven days of log retention. CPU settings must be finite values from 0 through 100,000; memory settings must be positive finite values; log retention must be an integer from 1 through 365 days. Settings writes must be atomic.

The log list, get, and search tools must restrict sources to router or policy and delegate data access to Ploinky's private log service. Daily maintenance must pass the configured retention days to Ploinky and retry failures with bounded backoff. The repository does not establish a separate local log rotation implementation.

## Conclusion

Authorization and log ownership remain with verified runtime context and Ploinky services, while Workspace Monitor owns input validation and the administrator-facing tool contract.
