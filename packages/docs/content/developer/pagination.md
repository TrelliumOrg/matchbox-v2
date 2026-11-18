---
title: Pagination
description: Gauge profile lists page with cursors, other lists return every match at once.
updated: 2026-11-10
---

Gauge profile lists return `{ data, nextCursor }`, newest update first. Pass `nextCursor` back as `cursor` until it is `null`.

::gauge-profiles-limit

:::code-group

```ts title="TypeScript"
import { createMatchboxClient } from "@matchbox-dev/sdk"

const matchbox = createMatchboxClient({
  apiKey: process.env.MATCHBOX_API_KEY ?? "",
})

for await (const profile of matchbox.gaugeProfiles.iterate({
  network: "mezo",
})) {
  console.log(profile.gaugeAddress)
}
```

```bash title="curl"
curl "https://api.matchbox.markets/v1/gauge-profiles?network=mezo&limit=100&cursor=$CURSOR" \
  -H "Authorization: Bearer $MATCHBOX_API_KEY"
```

:::

## Lists without pages {#lists-without-pages}

`/v1/gauges` and `/v1/incentives` return every match in one response.

::gauge-epochs-limit

## Caching {#caching}

Responses carry a weak `ETag`. Send it back as `If-None-Match` to get a `304` when nothing changed, and use `updatedSince` for incremental profile sync.
