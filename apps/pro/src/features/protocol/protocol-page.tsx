import { useNavigate } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"
import { useLiveQuery } from "../../data/live-query"
import { protocolQuery } from "../../data/queries"
import type { Protocol } from "../../data/view-models"
import { useHead } from "../../live/heads"
import { chainNow, useLive } from "../../live/live-context"
import { ProtocolView } from "./protocol-view"

/** The epoch last shown this session (client only). */
let lastShown: Protocol | null = null

/**
 * `/protocol` and `/protocol/40` are two routes, so picking an epoch can
 * remount the page. It first renders the epoch it last showed and two
 * frames later the new one, so figures roll, words morph and bars move
 * from one epoch to the next instead of appearing.
 */
function useFromLastEpoch(data: Protocol): Protocol {
  const [shown, setShown] = useState(() => lastShown ?? data)
  useEffect(() => {
    lastShown = data
    if (shown === data) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setShown(data))
    })
    return () => cancelAnimationFrame(frame)
  }, [data, shown])
  return shown
}

/**
 * Protocol at `/protocol` (the current epoch) and `/protocol/40`. Picking an
 * epoch (bars, their numbers, the arrows, the keyboard) changes the path.
 */
export function ProtocolPage({
  seed,
  epoch,
}: {
  seed: Protocol
  epoch: number | null
}): ReactNode {
  const data = useLiveQuery(protocolQuery(epoch), seed)
  const shown = useFromLastEpoch(data)
  const { store, market } = useLive()
  const head = useHead(store)
  const navigate = useNavigate()
  return (
    <ProtocolView
      data={shown}
      now={chainNow(market, head.number)}
      onEpoch={(next) =>
        void (next >= data.latestEpoch
          ? navigate({
              to: "/protocol",
              resetScroll: false,
              viewTransition: false,
            })
          : navigate({
              to: "/protocol/$epoch",
              params: { epoch: next },
              resetScroll: false,
              viewTransition: false,
            }))
      }
    />
  )
}
