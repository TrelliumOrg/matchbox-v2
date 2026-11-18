import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { LoanPositionLink } from "../data/scan/tx-loan"

/** A link to a loan's own page: a trove, an Enclave or a Morpho position. */
export function PositionLink({
  link,
  className = "rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink",
  children,
}: {
  link: LoanPositionLink
  className?: string
  children: ReactNode
}): ReactNode {
  if (link.kind === "trove") {
    return (
      <Link
        to="/borrow/troves/$owner"
        params={{ owner: link.owner }}
        className={className}
      >
        {children}
      </Link>
    )
  }
  if (link.kind === "enclave") {
    return (
      <Link
        to="/borrow/enclaves/$position"
        params={{ position: link.position }}
        className={className}
      >
        {children}
      </Link>
    )
  }
  return (
    <Link
      to="/borrow/markets/$market/$account"
      params={{ market: link.market, account: link.account }}
      className={className}
    >
      {children}
    </Link>
  )
}
