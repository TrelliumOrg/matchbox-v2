import type { GlyphShape } from "@matchbox/ui/icons"
import { shapes } from "@matchbox/ui/icons"
import { useRouterState } from "@tanstack/react-router"

/**
 * Pro navigation in its four shapes: the 280px sidebar with the full lockup
 * (1280 and up), the short-form lockup at 1180 and below, the 72px icon rail
 * at 834, and the phone tab bar with four items.
 */

type NavItem = {
  to: "/" | "/vote" | "/rewards" | "/activity" | "/protocol"
  label: string
  icon: GlyphShape
  /** Path prefixes that also mark the item active. */
  also: readonly string[]
  phone: boolean
}

export const navItems: readonly NavItem[] = [
  { to: "/", label: "Overview", icon: shapes.house, also: [], phone: true },
  {
    to: "/vote",
    label: "Vote",
    icon: shapes.vote,
    also: ["/gauges"],
    phone: true,
  },
  {
    to: "/rewards",
    label: "Rewards",
    icon: shapes.gift,
    also: [],
    phone: true,
  },
  {
    to: "/activity",
    label: "Activity",
    icon: shapes.list,
    also: [],
    phone: true,
  },
  {
    to: "/protocol",
    label: "Protocol",
    icon: shapes.chartColumn,
    also: [],
    phone: false,
  },
]

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === "/") return pathname === "/"
  return [item.to, ...item.also].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function usePathname(): string {
  return useRouterState({ select: (state) => state.location.pathname })
}
