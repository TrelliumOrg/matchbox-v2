---
title: Rate limits
description: Limits per environment, with a burst per minute and a daily quota.
updated: 2026-11-10
---

Limits apply per environment, with a burst per minute and a quota per day. Live environments get higher limits than test ones.

::rate-limits-table

::publishable-ip-limit

## Headers {#headers}

Every response carries the limit headers. A `429` adds `Retry-After`, in seconds.

::rate-limit-headers-table

## Retries {#retries}

The SDK retries `429` and `503` responses up to twice, so one call makes at most 3 attempts. It waits for `Retry-After` when the response has one, and backs off from half a second when not.

If `Retry-After` asks for more than 10 seconds, the SDK does not wait and throws the error at once. Change both with `maxRetries` and `maxRetryDelayMs`.
