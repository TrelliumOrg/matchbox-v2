/**
 * The docs site's structure: sections, their page trees and the URL of
 * every page. The build checks this against the content (every published
 * page sits in exactly one tree, every tree entry is a page) and drops
 * unpublished pages, so a stub never shows in the navigation.
 */

export const siteOrigin = "https://docs.matchbox.markets"

export const repositoryUrl = "https://github.com/MallardLabs/matchbox-v2"

/** "Edit on GitHub" links point at the content file on main. */
export const editBaseUrl = `${repositoryUrl}/edit/main/packages/docs/content`

export type SectionId =
  | "home"
  | "concepts"
  | "pro"
  | "scan"
  | "id"
  | "developer"
  | "stuart"

export type SectionIcon =
  | "house"
  | "shapes"
  | "vote"
  | "scan-search"
  | "circle-user-round"
  | "code-xml"
  | "dog"

export type TreeGroup = { label: string; paths: readonly string[] }

export type Tree = { id: string; groups: readonly TreeGroup[] }

export type Section = {
  id: SectionId
  /** Sidebar label. */
  label: string
  /** The product or area name, for eyebrows and search groups. */
  name: string
  href: string
  icon: SectionIcon
  /** The page tree shown beside a page of this section, if any. */
  tree: string | null
}

export const sections: readonly Section[] = [
  {
    id: "home",
    label: "Home",
    name: "Matchbox Docs",
    href: "/",
    icon: "house",
    tree: null,
  },
  {
    id: "concepts",
    label: "Concepts",
    name: "Concepts",
    href: "/concepts",
    icon: "shapes",
    tree: "concepts",
  },
  {
    id: "pro",
    label: "Pro",
    name: "Matchbox Pro",
    href: "/pro",
    icon: "vote",
    tree: "pro",
  },
  {
    id: "scan",
    label: "Matchscan",
    name: "Matchscan",
    href: "/scan",
    icon: "scan-search",
    tree: "scan",
  },
  {
    id: "id",
    label: "ID",
    name: "Matchbox ID",
    href: "/id",
    icon: "circle-user-round",
    tree: "id",
  },
  {
    id: "developer",
    label: "Developer",
    name: "Matchbox Developer",
    href: "/developer",
    icon: "code-xml",
    tree: "developer",
  },
  {
    id: "stuart",
    label: "Stuart",
    name: "Stuart",
    href: "/stuart",
    icon: "dog",
    tree: null,
  },
]

/**
 * Page trees in reading order. Paths that have no published page are left
 * out at build time. The API reference and MCP trees are filled in by the
 * generators (`/developer/api/...`, `/developer/mcp/tools/...`).
 */
export const trees: readonly Tree[] = [
  {
    id: "concepts",
    groups: [
      { label: "Start", paths: ["/concepts", "/concepts/mezo"] },
      {
        label: "Time and locks",
        paths: [
          "/concepts/epochs",
          "/concepts/vebtc",
          "/concepts/vemezo",
          "/concepts/locks",
        ],
      },
      {
        label: "Gauges",
        paths: [
          "/concepts/gauges",
          "/concepts/mezo-gauges",
          "/concepts/validator-gauges",
          "/concepts/pool-gauges",
          "/concepts/boost",
        ],
      },
      {
        label: "Earning",
        paths: [
          "/concepts/incentives",
          "/concepts/rewards",
          "/concepts/savings",
        ],
      },
      {
        label: "More",
        paths: ["/concepts/borrow", "/concepts/safety", "/concepts/glossary"],
      },
    ],
  },
  {
    id: "pro",
    groups: [
      { label: "Start", paths: ["/pro", "/pro/connect", "/pro/overview"] },
      {
        label: "Vote and earn",
        paths: [
          "/pro/vote",
          "/pro/optimize",
          "/pro/rewards",
          "/pro/incentives",
        ],
      },
      { label: "Locks", paths: ["/pro/locks", "/pro/gauge-profiles"] },
      {
        label: "More",
        paths: [
          "/pro/activity-and-protocol",
          "/pro/settings",
          "/pro/multisig",
          "/pro/troubleshooting",
          "/pro/faq",
        ],
      },
    ],
  },
  {
    id: "scan",
    groups: [
      { label: "Start", paths: ["/scan"] },
      {
        label: "Read the chain",
        paths: ["/scan/transactions", "/scan/addresses"],
      },
      { label: "Mezo Earn", paths: ["/scan/voting", "/scan/validators"] },
      { label: "Borrow", paths: ["/scan/borrow"] },
      { label: "Reference", paths: ["/scan/metrics"] },
    ],
  },
  {
    id: "id",
    groups: [
      { label: "Start", paths: ["/id", "/id/sign-in"] },
      {
        label: "Your account",
        paths: ["/id/connected-apps", "/id/sessions", "/id/appearance"],
      },
    ],
  },
  {
    id: "developer",
    groups: [
      {
        label: "Start",
        paths: ["/developer", "/developer/environments", "/developer/auth"],
      },
      {
        label: "Sign in",
        paths: ["/developer/oidc", "/developer/oidc/endpoints"],
      },
      {
        label: "Limits",
        paths: [
          "/developer/rate-limits",
          "/developer/errors",
          "/developer/pagination",
        ],
      },
      {
        label: "Tools",
        paths: [
          "/developer/sdk",
          "/developer/apps",
          "/developer/mcp",
          "/developer/mcp/tools",
        ],
      },
      { label: "Reference", paths: ["/developer/reference"] },
      { label: "Releases", paths: ["/developer/changelog"] },
    ],
  },
]

export function sectionById(id: SectionId): Section {
  const section = sections.find((candidate) => candidate.id === id)
  if (section === undefined) throw new Error(`Unknown section ${id}`)
  return section
}

/** The section a path belongs to, by its first segment. */
export function sectionOfPath(path: string): SectionId {
  const first = path.split("/")[1] ?? ""
  const match = sections.find(
    (section) => section.id !== "home" && section.href === `/${first}`,
  )
  return match?.id ?? "home"
}

/** Content file path (relative to content/) to its URL path. */
export function pathOfFile(file: string): string {
  const bare = file.replace(/\\/g, "/").replace(/\.md$/, "")
  if (bare === "index") return "/"
  return `/${bare.replace(/\/index$/, "")}`
}

/** The JSON chunk name for a page path: "/pro/vote" to "pro__vote". */
export function chunkName(path: string): string {
  if (path === "/") return "index"
  return path.slice(1).replaceAll("/", "__")
}
