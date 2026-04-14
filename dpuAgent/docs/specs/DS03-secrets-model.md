# DS03 - Secrets Model

## Summary

In `dpuAgent`, a secret is not just a key-value pair. It is a metadata record, an access control list (ACL)-controlled object, and an encrypted value stored outside the metadata registry.

## Background / Problem Statement

Secrets need two things that should not be merged casually:

- operational metadata that Explorer can list and inspect
- sensitive values that should only be materialized for actors with the right role

If the value lived directly inside the metadata record, the metadata store would stop being safe to inspect or serialize broadly.

## Domain Split

The secret model is split across three places:

- metadata in `state.secrets`
- access control list state in `permissions.manifest.json`
- encrypted values in `secrets.json`

The public tool surface then serializes the result according to the caller’s role instead of dumping raw storage state.

## Secret Keys and Roles

Secret keys are normalized through `normalizeSecretKey()`. The current implementation expects environment-variable-style keys.

Secret roles are:

- `access`
- `read`
- `write`

These roles are not equivalent. An actor with `access` can be authorized operationally without seeing the plaintext value. An actor with `read` can see the value. An actor with `write` can update the value and inspect access control list details.

## Practical Operation

`putSecret()` resolves the authenticated actor, normalizes the key, creates or updates secret metadata, writes the encrypted value through `upsertSecretsFileValue()`, and returns the actor-filtered serialized secret.

`listSecrets()` and `getSecretByKey()` resolve the actor first and only expose secret entries whose role allows `access`. Plaintext value materialization only happens when the role allows `read`.

`deleteSecret()` removes:

- the metadata entry
- the access control list entry
- the encrypted value from `secrets.json`

This keeps secret lifecycle state explicit instead of spreading it across Explorer-side caches or filesystem semantics.
