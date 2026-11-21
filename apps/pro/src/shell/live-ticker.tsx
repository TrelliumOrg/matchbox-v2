import * as BlockTicker from "@matchbox/ui/block-ticker"
import type { ReactNode } from "react"
import { useHead } from "../live/heads"
import { useLive } from "../live/live-context"

/**
 * The block ticker on the live head, linking to the block on Matchscan in a
 * new tab, as Pro's other links out do.
 */

const scanBlock = (block: number): string =>
  `https://scan.matchbox.markets/block/${block}`

export function LiveBlockTicker({
  className,
}: {
  className?: string
}): ReactNode {
  const { store } = useLive()
  const head = useHead(store)
  return (
    <BlockTicker.Root
      block={head.number}
      receivedAt={head.receivedAt}
      href={scanBlock(head.number)}
      newTab
      {...(className === undefined ? {} : { className })}
    />
  )
}
