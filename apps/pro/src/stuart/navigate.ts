import { registerSearchCommands } from "@matchbox/stuart-ui/commands"
import type { useRouter } from "@tanstack/react-router"
import { calcSearch } from "../boost/calc-link"

/**
 * Stuart's links in Pro: gauge profiles, the five pages, and another
 * wallet as `/?address=` (Pro reads the viewer from the search params).
 * Anything else is ignored, so an answer can never send the app elsewhere.
 */

type Router = ReturnType<typeof useRouter>

type PagePath = "/" | "/vote" | "/rewards" | "/activity" | "/protocol"

const pagePaths: readonly string[] = [
  "/",
  "/vote",
  "/rewards",
  "/activity",
  "/protocol",
]

function isPagePath(to: string): to is PagePath {
  return pagePaths.includes(to)
}

const gaugePath = /^\/gauges\/(0x[0-9a-fA-F]{40})$/
const walletPath = /^\/\?address=(0x[0-9a-fA-F]{40})$/

/** Pro's pages in the search box, under "Pages". */
const pageCommands = [
  {
    id: "page-overview",
    label: "Overview",
    hint: "Locks and what is ready to claim",
    keywords: ["home", "locks", "claimable"],
    to: "/",
  },
  {
    id: "page-vote",
    label: "Vote",
    hint: "Split votes across gauges",
    keywords: ["gauges", "ballot", "optimize"],
    to: "/vote",
  },
  {
    id: "page-rewards",
    label: "Rewards",
    hint: "Claimable by lock and by gauge",
    keywords: ["claim", "incentives", "earned"],
    to: "/rewards",
  },
  {
    id: "page-activity",
    label: "Activity",
    hint: "Votes, claims, locks and incentives",
    keywords: ["history", "transactions"],
    to: "/activity",
  },
  {
    id: "page-protocol",
    label: "Protocol",
    hint: "Mezo Earn by epoch",
    keywords: ["epoch", "epochs", "stats", "incentives"],
    to: "/protocol",
  },
].map((command) => ({ ...command, group: "Pages" }))

/** The search box's "Boost calculator" row (see `registerProCommands`). */
export const calculatorPath = "?calc=1"

/** Pro's tools in the search box: typing "boost" lists the calculator. */
export function registerProCommands(): void {
  registerSearchCommands([
    {
      id: "boost-calculator",
      label: "Boost calculator",
      hint: "veMEZO a veBTC lock needs for 5×",
      keywords: ["vemezo", "vebtc", "5x", "multiplier", "tool"],
      to: calculatorPath,
    },
    ...pageCommands,
  ])
}

/** The viewed wallet, and nothing else, for the page being opened. */
export function keepAddress(now: { address?: string | undefined }): {
  address?: string
} {
  return now.address === undefined ? {} : { address: now.address }
}

export function stuartNavigate(router: Router, to: string): void {
  if (to === calculatorPath) {
    // Over the page the person is on; Back closes it.
    void router.navigate({
      to: ".",
      search: (now) => ({ ...now, ...calcSearch({}) }),
      resetScroll: false,
    })
    return
  }
  const gauge = gaugePath.exec(to)?.[1]
  if (gauge !== undefined) {
    void router.navigate({ to: "/gauges/$address", params: { address: gauge } })
    return
  }
  const wallet = walletPath.exec(decodeURIComponent(to))?.[1]
  if (wallet !== undefined) {
    void router.navigate({ to: "/", search: { address: wallet.toLowerCase() } })
    return
  }
  // A page keeps the wallet being viewed: without the address the router
  // would show the connected wallet's page instead.
  if (isPagePath(to)) {
    void router.navigate({ to, search: (now) => keepAddress(now) })
  }
}

/** The Stuart Worker's origin; null plays the Epoch 47 fixtures. */
export function stuartEndpoint(): string | null {
  const value: unknown = import.meta.env.VITE_STUART_URL
  return typeof value === "string" && value !== "" ? value : null
}

registerProCommands()
