---
title: DS004-monitoring-and-history
summary: Defines metric aggregation, per-runtime series, threshold recording, bucketization, and history limits.
---

# DS004 Monitoring And History

## Introduction

This specification defines how collected resource observations become queryable history.

## Core Content

The collector must derive workspace CPU and memory from available runtime metrics, with a fallback to total metrics minus Router metrics when runtime details are absent. Router CPU and memory must be recorded as separate series. Each available runtime must receive encoded CPU and memory series keyed by repository and agent identity when those fields exist, or by the runtime container identity.

A persistence checkpoint must be tracked independently per series and must use the ten-second cadence. A failed persistence call must not advance that checkpoint. Invalid series keys, non-finite values, and non-finite thresholds must be rejected before SQLite commit.

History queries must accept a selected set of aggregate or supported runtime series and return bucketed values, peak timestamps, peak thresholds, and latest bucket thresholds. A request must contain a later to instant, remain within thirteen months, and return at least two and at most 50,000 points per series.

## Conclusion

History preserves enough metric and threshold context for administrators to compare resource peaks with the settings that were active when they were recorded.
