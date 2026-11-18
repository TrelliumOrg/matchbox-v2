import { formatDuration } from "@matchbox/domain/format"
import { useLive } from "@matchbox/live/context"
import { useHead } from "@matchbox/live/heads"
import * as BlockTicker from "@matchbox/ui/block-ticker"
import * as PriceSlot from "@matchbox/ui/price-slot"
import { type ReactNode, useSyncExternalStore } from "react"
import { useChainClock, useShell } from "../data/shell-context"

/**
 * The live tickers (`ZxcFhQWGoD`): the price slot cycling MEZO, BTC and the
 * epoch countdown, and the block ticker. Both follow the head store.
 */

/** Below 1280px: the phone layout. The server renders the wide one. */
const phoneQuery = "(width < 80rem)"

function subscribePhone(onChange: () => void): () => void {
  const media = window.matchMedia(phoneQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  )
}

export function LivePriceSlot({
  className,
  rootClassName,
}: {
  className?: string
  rootClassName?: string
}): ReactNode {
  const shell = useShell()
  const { now, epoch } = useChainClock()
  const phone = useIsPhone()
  return (
    <PriceSlot.Root
      mezo={shell.prices.mezo}
      btc={shell.prices.btc}
      epoch={{
        label: `Epoch ${epoch.number}`,
        remaining: formatDuration(epoch.endsAt - now),
      }}
      compact={phone}
      epochClassName="max-xl:hidden"
      {...(className === undefined ? {} : { className })}
      {...(rootClassName === undefined ? {} : { rootClassName })}
    />
  )
}

export function LiveBlockTicker({
  className,
}: {
  className?: string
}): ReactNode {
  const { store } = useLive()
  const head = useHead(store)
  // No head yet (the server's read failed): nothing to show until one lands.
  if (head.number === 0) return null
  return (
    <BlockTicker.Root
      block={head.number}
      receivedAt={head.receivedAt}
      href={`/block/${head.number}`}
      {...(className === undefined ? {} : { className })}
    />
  )
}

/**
 * The top bar's live pair: the price slot and the block ticker. Below
 * 1280px the slot clips before the bar overflows (a 360px phone has about
 * 110px for it beside the mark, search and Connect), and the ticker's
 * wrapper is not rendered below 1440px, so it takes no gap in the bar.
 */
export function LiveWidgets(): ReactNode {
  return (
    <>
      <LivePriceSlot
        className="max-xl:min-w-0 max-xl:flex-initial max-xl:px-1.5"
        rootClassName="max-xl:min-w-0"
      />
      <span className="contents max-[90rem]:hidden">
        <LiveBlockTicker />
      </span>
    </>
  )
}
