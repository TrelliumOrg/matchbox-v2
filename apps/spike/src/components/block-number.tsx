import NumberFlow from "@number-flow/react"
import { type ReactNode, useEffect, useState } from "react"

const blockTimeMs = 3800
const firstBlock = 13078795

export function BlockNumber(): ReactNode {
  const [block, setBlock] = useState(firstBlock)

  useEffect(() => {
    const timer = setInterval(() => setBlock((value) => value + 1), blockTimeMs)
    return () => clearInterval(timer)
  }, [])

  return (
    <p className="block-number">
      <span className="sr-only">Latest block </span>
      <NumberFlow
        value={block}
        trend={1}
        format={{ useGrouping: true }}
        transformTiming={{ duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" }}
      />
    </p>
  )
}
