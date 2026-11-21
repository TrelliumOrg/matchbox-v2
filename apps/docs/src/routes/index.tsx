import { manifest } from "@matchbox/docs/manifest"
import { siteOrigin } from "@matchbox/docs/site"
import { CopyButton } from "@matchbox/ui/code-block"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import { Kbd } from "@matchbox/ui/kbd"
import * as Prose from "@matchbox/ui/prose"
import { createFileRoute } from "@tanstack/react-router"
import { Fragment, type ReactNode, useEffect } from "react"
import { DocLink } from "../content/doc-link"
import { DogDisc } from "../shell/dog"
import { outboundLinks } from "../shell/site-footer"
import { search } from "../shell/store"

/**
 * Home (Doop `74pRMD0ECU`, phone `rYVkMzZvsq`): the search field, the four
 * product cards in their tab colours, the concepts and the developer
 * card. Only published pages are linked; card counts come from the build.
 * Layout v2: the content spans the 1360 grid under the header, and the Pro
 * and Matchscan cards carry Open Pro and Open Matchscan.
 */

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Matchbox Docs" },
      { property: "og:title", content: "Matchbox Docs" },
      { property: "og:url", content: `${siteOrigin}/` },
    ],
    links: [{ rel: "canonical", href: `${siteOrigin}/` }],
  }),
  component: Home,
})

/** Phones: a link standing on its own is at least 40 tall (D3). */
const phoneTap = "max-md:inline-flex max-md:min-h-10 max-md:items-center"

type Product = {
  name: string
  section: "pro" | "scan" | "id" | "developer"
  audience: string
  tab: string
  links: readonly { path: string; label: string }[]
  /** The product itself, beside All pages. */
  open?: (typeof outboundLinks)[number]
}

const products: readonly Product[] = [
  {
    name: "Matchbox Pro",
    section: "pro",
    audience: "For voters",
    tab: "bg-mezo text-on-mezo",
    open: outboundLinks[0],
    links: [
      { path: "/pro/vote", label: "Vote" },
      { path: "/pro/optimize", label: "Optimize" },
      { path: "/pro/rewards", label: "Rewards" },
      { path: "/pro/locks", label: "Locks" },
    ],
  },
  {
    name: "Matchscan",
    section: "scan",
    audience: "For explorers",
    tab: "bg-acc-soft text-acc-ink",
    open: outboundLinks[1],
    links: [
      { path: "/scan", label: "Search" },
      { path: "/scan/transactions", label: "Transactions" },
      { path: "/scan/voting", label: "Voting" },
      { path: "/scan/borrow", label: "Borrow" },
    ],
  },
  {
    name: "Matchbox ID",
    section: "id",
    audience: "For everyone",
    tab: "bg-ink text-bg",
    links: [
      { path: "/id/sign-in", label: "Sign in" },
      { path: "/id/connected-apps", label: "Connected apps" },
      { path: "/id/sessions", label: "Sessions" },
      { path: "/id/appearance", label: "Appearance" },
    ],
  },
  {
    name: "Matchbox Developer",
    section: "developer",
    audience: "For builders",
    tab: "bg-ink2 text-bg",
    links: [
      { path: "/developer", label: "Quickstart" },
      { path: "/developer/oidc", label: "Sign in with Matchbox" },
      { path: "/developer/reference", label: "API reference" },
      { path: "/developer/mcp", label: "MCP" },
    ],
  },
]

const concepts: readonly { path: string; icon: GlyphShape; subline: string }[] =
  [
    {
      path: "/concepts/epochs",
      icon: shapes.clock,
      subline: "Thursday to Thursday, UTC",
    },
    {
      path: "/concepts/vebtc",
      icon: shapes.lock,
      subline: "Votes on validators and pools",
    },
    {
      path: "/concepts/vemezo",
      icon: shapes.lock,
      subline: "Votes on two gauge types",
    },
    {
      path: "/concepts/gauges",
      icon: shapes.gauge,
      subline: "Four types, one per voter",
    },
    {
      path: "/concepts/boost",
      icon: shapes.chevronsUp,
      subline: "Up to 5× on veBTC gauges",
    },
    {
      path: "/concepts/incentives",
      icon: shapes.gift,
      subline: "Paid to voters, per gauge",
    },
    {
      path: "/concepts/rewards",
      icon: shapes.coins,
      subline: "Claim, or claim and relock",
    },
    {
      path: "/concepts/borrow",
      icon: shapes.landmark,
      subline: "Enclaves, Morpho, troves",
    },
  ]

const popular = [
  { path: "/pro/vote", label: "Vote" },
  { path: "/concepts/epochs", label: "Epochs" },
  {
    path: "/developer/api/incentives/list-incentives",
    label: "List incentives",
  },
  { path: "/developer/oidc", label: "Sign in with Matchbox" },
]

function published(path: string): boolean {
  return manifest.pages[path] !== undefined
}

/** On a phone it wraps only between words, never inside the package name. */
const install = "pnpm add @matchbox-dev/sdk"

function Home(): ReactNode {
  // Old not-found pages and links send ?q= to open search here.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("q")
    if (query !== null && query.trim() !== "")
      search.open(query.trim().slice(0, 80))
  }, [])
  const shownPopular = popular.filter((item) => published(item.path))
  const shownConcepts = concepts.filter((item) => published(item.path))
  return (
    <main
      id="content"
      tabIndex={-1}
      className="mx-auto max-w-[1440px] px-5 pt-6 pb-16 outline-none md:px-8 md:pt-[78px] lg:px-10"
    >
      <h1 className="text-[32px] leading-tight font-[650] tracking-[-0.02em] text-ink md:text-center md:text-[44px]">
        Learn Matchbox
      </h1>
      <div className="mx-auto mt-6 max-w-[760px] md:mt-8">
        <button
          type="button"
          onClick={() => search.open()}
          onPointerEnter={search.warm}
          onFocus={search.warm}
          aria-keyshortcuts="Control+K Meta+K"
          className="flex h-[54px] w-full cursor-pointer items-center gap-3 rounded-[32px] bg-soft pr-3.5 pl-2.5 text-left text-[17px] text-sec outline-none focus-visible:outline-2 focus-visible:outline-ink md:h-16 md:text-[18px]"
        >
          <DogDisc size={38} className="bg-bg dark:bg-bg dark:text-ink" />
          <span className="flex-1">Ask Stuart or search docs</span>
          <span className="max-md:hidden">
            <Kbd keys={["mod", "k"]} />
          </span>
        </button>
        {shownPopular.length === 0 ? null : (
          <p className="mt-[22px] flex flex-wrap justify-center gap-x-[22px] gap-y-2 text-[15px] text-sec max-md:hidden">
            <span>Popular</span>
            {shownPopular.map((item) => (
              <DocLink
                key={item.path}
                href={item.path}
                className={Prose.linkClass}
              >
                {item.label}
              </DocLink>
            ))}
          </p>
        )}
      </div>

      <section aria-labelledby="products" className="mt-12 md:mt-[84px]">
        <h2
          id="products"
          className="text-[22px] font-[650] text-ink md:text-[24px]"
        >
          Products
        </h2>
        <ul className="-mx-5 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:grid-cols-2 md:px-0 xl:grid-cols-4">
          {products.map((product) => {
            const links = product.links.filter((link) => published(link.path))
            const count = manifest.counts[product.section]
            return (
              <li
                key={product.section}
                className="flex w-[250px] flex-none snap-start flex-col overflow-hidden rounded-[24px] bg-soft md:w-auto"
              >
                <DocLink
                  href={`/${product.section}`}
                  className={`flex h-[54px] items-center justify-between px-5 text-[15.5px] font-semibold outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-current ${product.tab}`}
                >
                  {product.name}
                  <span className="text-[14px] font-normal">
                    {count} {count === 1 ? "page" : "pages"}
                  </span>
                </DocLink>
                <div className="flex flex-1 flex-col px-5 pt-4 pb-5">
                  <p className="text-[15px] text-sec">{product.audience}</p>
                  <ul className="mt-1.5 flex-1">
                    {links.map((link) => (
                      <li key={link.path}>
                        <DocLink
                          href={link.path}
                          className="-mx-2 flex h-10 items-center justify-between rounded-xl px-2 text-[16px] text-ink2 outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
                        >
                          {link.label}
                          <Glyph
                            shape={shapes.chevronRight}
                            size={17}
                            strokeWidth={1.75}
                            className="text-sec"
                          />
                        </DocLink>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <DocLink
                      href={`/${product.section}`}
                      className={`w-fit text-[15px] font-semibold ${phoneTap} ${Prose.linkClass}`}
                    >
                      All {product.name.replace("Matchbox ", "")} pages
                    </DocLink>
                    {product.open === undefined ? null : (
                      <a
                        href={product.open.href}
                        className="flex items-center gap-1 rounded-md text-[15px] whitespace-nowrap text-sec outline-none max-md:min-h-10 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
                      >
                        <Glyph
                          shape={shapes.arrowUpRight}
                          size={14}
                          strokeWidth={2}
                        />
                        {product.open.label}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {shownConcepts.length === 0 ? null : (
        <section aria-labelledby="concepts" className="mt-12 md:mt-[72px]">
          <div className="flex items-baseline justify-between">
            <h2
              id="concepts"
              className="text-[22px] font-[650] text-ink md:text-[24px]"
            >
              Concepts
            </h2>
            <DocLink
              href="/concepts"
              className={`text-[15px] font-semibold ${phoneTap} ${Prose.linkClass}`}
            >
              All concepts
            </DocLink>
          </div>
          <ul className="mt-4 grid gap-x-4 gap-y-2 md:grid-cols-2 xl:grid-cols-4">
            {shownConcepts.map((concept) => {
              const page = manifest.pages[concept.path]
              return (
                <li key={concept.path}>
                  <DocLink
                    href={concept.path}
                    className="-mx-2 flex items-center gap-3.5 rounded-[20px] px-2 py-2.5 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-12 flex-none place-items-center rounded-full bg-soft text-ink2"
                    >
                      <Glyph
                        shape={concept.icon}
                        size={20}
                        strokeWidth={1.75}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-ink">
                        {page?.title}
                      </span>
                      <span className="block text-[14.5px] text-sec">
                        {concept.subline}
                      </span>
                    </span>
                  </DocLink>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="build"
        className="mt-12 flex flex-wrap items-center justify-between gap-6 rounded-[24px] bg-soft px-6 py-7 md:mt-[72px] md:px-8"
      >
        <div>
          <h2 id="build" className="text-[22px] font-[650] text-ink">
            Build on Matchbox
          </h2>
          <p className="mt-3 flex flex-wrap gap-x-[22px] gap-y-2 text-[15px] max-md:gap-y-0">
            {[
              { path: "/developer", label: "Quickstart" },
              { path: "/developer/reference", label: "API reference" },
              { path: "/developer/mcp/tools", label: "MCP tools" },
              { path: "/developer/changelog", label: "Changelog" },
            ]
              .filter((item) => published(item.path))
              .map((item) => (
                <DocLink
                  key={item.path}
                  href={item.path}
                  className={`font-semibold ${phoneTap} ${Prose.linkClass}`}
                >
                  {item.label}
                </DocLink>
              ))}
          </p>
        </div>
        <div className="flex min-h-14 w-full max-w-[470px] items-center gap-3 rounded-2xl bg-bg py-2 pr-2 pl-5 font-mono text-[14.5px] text-ink">
          <span aria-hidden="true" className="text-sec">
            $
          </span>
          <code className="min-w-0 flex-1 sm:truncate">
            {install.split(" ").map((word, index) => (
              <Fragment key={word}>
                {index === 0 ? null : " "}
                <span className="whitespace-nowrap">{word}</span>
              </Fragment>
            ))}
          </code>
          <CopyButton source={install} />
        </div>
      </section>
    </main>
  )
}
