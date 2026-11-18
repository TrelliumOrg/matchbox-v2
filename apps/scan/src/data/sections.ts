import type { docsOrigin, docsTopics } from "@matchbox/docs/links"
import { type GlyphShape, shapes } from "@matchbox/ui/icons"

/**
 * The nav sections (screen map `W-Dfd1Wpsn`), in nav order. Pools sits
 * between Borrow and Gauges (`fo6wFx4RD8`): Borrow takes MUSD out, Pools
 * puts it to work, Gauges decides where MEZO goes. Each page is a
 * placeholder until its phase: the title and a designed empty state.
 */

export type SectionId =
  | "home"
  | "network"
  | "borrow"
  | "pools"
  | "gauges"
  | "validators"
  | "locks"
  | "epochs"
  | "tokens"

export type Section = {
  id: SectionId
  to:
    | "/"
    | "/network"
    | "/borrow"
    | "/pools"
    | "/gauges"
    | "/validators"
    | "/locks"
    | "/epochs"
    | "/tokens"
  label: string
  icon: GlyphShape
  /** One of the phone's bottom tabs; the rest sit under More. */
  phoneTab: boolean
  /** Path prefixes that also mark the item active. */
  also: readonly string[]
}

export const sections: readonly Section[] = [
  {
    id: "home",
    to: "/",
    label: "Home",
    icon: shapes.house,
    phoneTab: true,
    also: [],
  },
  {
    id: "network",
    to: "/network",
    label: "Network",
    icon: shapes.box,
    // Under More on phones, to make room for Pools.
    phoneTab: false,
    also: ["/tx", "/block", "/address"],
  },
  {
    id: "borrow",
    to: "/borrow",
    label: "Borrow",
    icon: shapes.creditCard,
    phoneTab: true,
    also: [],
  },
  {
    id: "pools",
    to: "/pools",
    label: "Pools",
    icon: shapes.droplets,
    phoneTab: true,
    also: [],
  },
  {
    id: "gauges",
    to: "/gauges",
    label: "Gauges",
    icon: shapes.squareCheck,
    phoneTab: true,
    also: [],
  },
  {
    id: "validators",
    to: "/validators",
    label: "Validators",
    icon: shapes.shieldCheck,
    phoneTab: false,
    also: [],
  },
  {
    id: "locks",
    to: "/locks",
    label: "Locks",
    icon: shapes.lock,
    phoneTab: false,
    also: [],
  },
  {
    id: "epochs",
    to: "/epochs",
    label: "Epochs",
    icon: shapes.calendarDays,
    phoneTab: false,
    also: [],
  },
  {
    id: "tokens",
    to: "/tokens",
    label: "Tokens",
    icon: shapes.coins,
    phoneTab: false,
    also: [],
  },
]

export function sectionFor(id: SectionId): Section {
  const found = sections.find((section) => section.id === id)
  if (found === undefined) throw new Error(`Unknown section ${id}`)
  return found
}

export function isActive(section: Section, pathname: string): boolean {
  if (section.to === "/") return pathname === "/"
  return [section.to, ...section.also].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * Scan's docs page, checked against @matchbox/docs's topics at compile
 * time: renaming or removing the page (or moving the docs origin) stops
 * Scan compiling. The URL is a literal rather than `docsUrl("scan")`,
 * which would put the whole topics table into every page's first paint
 * (this module is in the shell).
 */
const scanDocs: `${typeof docsOrigin}${(typeof docsTopics)["scan"]}` =
  "https://docs.matchbox.markets/scan"

/** Links in the footer and the phone's More sheet. */
export const outbound = [
  { label: "Matchbox Pro", href: "https://pro.matchbox.markets" },
  { label: "API", href: "https://developer.matchbox.markets" },
  { label: "Documentation", href: scanDocs },
] as const
