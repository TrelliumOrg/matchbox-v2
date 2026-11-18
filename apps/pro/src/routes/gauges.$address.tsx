import { nameWithPoolType } from "@matchbox/domain/pool-type"
import { sizedPictureUrl } from "@matchbox/ui/gauge-card"
import { createFileRoute, notFound } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { fetchLive, useLiveQuery } from "../data/live-query"
import { gaugeQuery } from "../data/queries"
import type { GaugeProfile } from "../data/view-models"
import { GaugeView } from "../features/gauge/gauge-view"
import { isAddress } from "../lib/format"
import { useLive } from "../live/live-context"

export const Route = createFileRoute("/gauges/$address")({
  loader: async ({ params }) => {
    if (!isAddress(params.address)) throw notFound()
    const profile = await fetchLive(gaugeQuery(params.address))
    if (profile === null) throw notFound()
    return profile
  },
  head: ({ loaderData }) => {
    const picture = loaderData?.gauge.picture
    return {
      meta: [
        {
          title: `${
            loaderData === undefined
              ? "Gauge"
              : nameWithPoolType(
                  loaderData.gauge.name,
                  loaderData.gauge.poolLabel ?? null,
                )
          }, Matchbox Pro`,
        },
      ],
      // The profile picture is the page's largest element.
      links:
        picture?.kind === "image"
          ? [
              {
                rel: "preload",
                as: "image",
                // The same two sizes the profile's <img> asks for (104px).
                href: sizedPictureUrl(picture.url, 104),
                imageSrcSet: `${sizedPictureUrl(picture.url, 104)} 1x, ${sizedPictureUrl(picture.url, 208)} 2x`,
                fetchPriority: "high",
              },
            ]
          : [],
    }
  },
  component: GaugeRoute,
})

function GaugeRoute(): ReactNode {
  const seed: GaugeProfile = Route.useLoaderData()
  const data = useLiveQuery(gaugeQuery(seed.gauge.address), seed)
  const { market } = useLive()
  return <GaugeView data={data ?? seed} epoch={market.epoch.number} />
}
