import {
  addressAvatar,
  groupThousands,
  shortAddress,
} from "@matchbox/domain/format"
import * as Avatar from "@matchbox/ui/avatar"
import * as HashChip from "@matchbox/ui/hash-chip"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as SubTabs from "@matchbox/ui/sub-tabs"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import {
  createFileRoute,
  Link,
  lazyRouteComponent,
  notFound,
  Outlet,
  redirect,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { transactionWord } from "../data/address-counts"
import { canonicalAddress } from "../data/canonical"
import { getAddressDocument } from "../data/entities"
import { getAddressTokens } from "../data/explorer"
import { Tiles } from "../explorer/address/tiles"
import {
  useWalletPanels,
  WalletPanelsProvider,
} from "../explorer/address/wallet-panels"
import { MezoIdMark, SectionState } from "../explorer/parts"

/**
 * An address (`eSwId--0MF`, phone `jLeuv1K6AB`), from its composed
 * document: our label, Blockscout's summary and counters, its locks, open
 * loans and first page of activity in one subrequest (plus its token
 * balances, which the document does not carry). Tiles show only where
 * every input exists (loan health, veBTC locked, wallet). Each tab is its
 * own route, so a page loads only its tab's code: Positions (index),
 * Votes, Activity, Loan history, Transfers, All transactions. A Mezo ID
 * in the URL (`/address/alice.mezo/votes`) redirects to its wallet's
 * address, the canonical URL, and so does a Bitcoin address Mezo links
 * with one (`/address/bc1q…`); the address's own Mezo ID and its linked
 * Bitcoin address show above it.
 * A lock owner adds rewards claimed, the locks' voting streak, veMEZO
 * votes and claimable (wallet.server) and a Rewards tab, read by the
 * browser after the page (wallet-panels): the page never waits for the
 * chain reads behind them. Left out until their data
 * exists: net worth, "First seen", "Voter since", Watch.
 */

const tabs = [
  { to: "/address/$address", label: "Positions", key: "positions" },
  { to: "/address/$address/votes", label: "Votes", key: "votes" },
  { to: "/address/$address/rewards", label: "Rewards", key: "rewards" },
  { to: "/address/$address/activity", label: "Activity", key: "activity" },
  { to: "/address/$address/loans", label: "Loan history", key: "loans" },
  { to: "/address/$address/transfers", label: "Transfers", key: "transfers" },
  {
    to: "/address/$address/transactions",
    label: "All transactions",
    key: "transactions",
  },
] as const

/** The old `?tab=` links, now paths. */
const legacyTabs = new Set([
  "votes",
  "rewards",
  "activity",
  "loans",
  "transfers",
  "transactions",
])

export const Route = createFileRoute("/address/$address")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === "string" && legacyTabs.has(search.tab)
      ? { tab: search.tab }
      : {},
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: async ({ params, deps, location }) => {
    const address = canonicalAddress(params.address)
    if (address === null) {
      // `/address/alice.mezo`, `/address/bc1q…`: not permanent, an ID or
      // a link can move.
      const { mezoIdAddressPath } = await import("../data/mezo-id-path")
      const href = await mezoIdAddressPath(
        params.address,
        location.pathname,
        legacyTabs,
      )
      if (href === null || href === "none") throw notFound({ data: href })
      throw redirect({ href, statusCode: 302 })
    }
    if (deps.tab !== undefined) {
      throw redirect({
        href: `/address/${address}/${deps.tab}`,
        statusCode: 301,
      })
    }
    if (address !== params.address) {
      throw redirect({
        to: "/address/$address",
        params: { address },
        statusCode: 301,
      })
    }
    const doc = await getAddressDocument({ data: { address } })
    if (doc.summary.status === "missing") throw notFound()
    // The document carries the first page of balances with USD values;
    // an answer without that part falls back to the proxy's list.
    const tokens = doc.tokens ?? (await getAddressTokens({ data: { address } }))
    // A lock owner's wallet panels load in the browser (wallet-panels).
    const owner = doc.locks.status === "ok" && doc.locks.data.items.length > 0
    return {
      address,
      doc,
      tokens,
      owner,
      now: Math.floor(Date.now() / 1000),
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData === undefined
            ? "Address, Matchscan"
            : `${loaderData.doc.label?.name ?? `Address ${shortAddress(loaderData.address)}`}, Matchscan`,
      },
    ],
  }),
  component: AddressPage,
  notFoundComponent: lazyRouteComponent(
    () => import("../shell/entity-not-found"),
    "AddressNotFound",
  ),
})

const count = (value: string | null): string | null =>
  value === null ? null : groupThousands(BigInt(value))

function AddressPage(): ReactNode {
  const data = Route.useLoaderData()
  const { address, doc } = data
  const avatar = addressAvatar(address)
  const summary = doc.summary.status === "ok" ? doc.summary.data : null
  const name = doc.label?.name ?? summary?.name ?? null
  const counts: Partial<Record<(typeof tabs)[number]["key"], string | null>> = {
    transactions: count(doc.transactionCount),
    transfers: count(doc.transferCount),
  }
  const panels = useWalletPanels(address, data.owner)
  return (
    <>
      <header className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-4 max-xl:mt-6">
        <Avatar.Root initials={avatar.initials} hue={avatar.hue} size={72} />
        <div className="min-w-0 flex-1">
          {name === null &&
          doc.mezoId === null &&
          doc.btcAddress === null ? null : (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[16px] font-semibold">
              {name === null ? null : (
                <UntrustedText.Root value={name} limit={48} />
              )}
              {doc.mezoId === null ? null : (
                <span className="flex items-center gap-1.5">
                  {doc.mezoId}
                  <MezoIdMark />
                </span>
              )}
              {doc.btcAddress === null ? null : (
                // biome-ignore lint/a11y/useSemanticElements: names the chip and its copy button, not a form fieldset
                <span
                  role="group"
                  aria-label="Bitcoin address"
                  className="flex items-center gap-1.5 font-normal"
                >
                  <span className="text-sec">BTC</span>
                  <HashChip.Root value={doc.btcAddress} head={8} tail={6} />
                </span>
              )}
            </p>
          )}
          <h1 className="leading-tight">
            <HashChip.Root value={address} head={12} tail={10}>
              <HashChip.Value className="text-[24px]! font-[650] max-md:text-[17px]! max-sm:text-[15px]!" />
              <HashChip.Copy />
            </HashChip.Root>
          </h1>
          <p className="mt-1 flex flex-wrap gap-x-4 text-[15px] text-sec">
            {counts.transactions === null ||
            counts.transactions === undefined ? null : (
              <span>
                <span className="font-semibold text-ink">
                  {counts.transactions}
                </span>{" "}
                {transactionWord(counts.transactions)}
              </span>
            )}
            {summary?.contract === true ? (
              <span>{summary.verified ? "Verified contract" : "Contract"}</span>
            ) : null}
            {doc.label?.tags.map((tag) => (
              <span key={tag}>
                <UntrustedText.Root value={tag} limit={24} />
              </span>
            ))}
          </p>
        </div>
        <a
          href={`https://pro.matchbox.markets/${address}`}
          className="flex h-11 items-center justify-center gap-2 rounded-[22px] bg-ink px-5 font-semibold text-bg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink max-md:w-full"
        >
          Open in Matchbox Pro
          <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2} />
        </a>
      </header>
      {doc.summary.status === "ok" ? (
        <Tiles
          balance={summary?.balance ?? null}
          tokens={data.tokens}
          borrow={doc.borrow}
          locks={doc.locks}
          panels={panels}
        />
      ) : (
        <div className="mt-8">
          <SectionState section={doc.summary} />
        </div>
      )}
      <SubTabs.Root label="Address" className="mt-10">
        {tabs
          .filter((each) => each.key !== "rewards" || data.owner)
          .map((each) => {
            const number = counts[each.key]
            return (
              <SubTabs.Item key={each.key}>
                <Link
                  to={each.to}
                  params={{ address }}
                  activeOptions={{ exact: true, includeSearch: false }}
                >
                  {each.label}
                  {number === null || number === undefined ? null : (
                    <span className="text-[14px] font-normal text-sec">
                      {number}
                    </span>
                  )}
                </Link>
              </SubTabs.Item>
            )
          })}
      </SubTabs.Root>
      <div className="mt-2">
        <WalletPanelsProvider value={panels}>
          <Outlet />
        </WalletPanelsProvider>
      </div>
    </>
  )
}
