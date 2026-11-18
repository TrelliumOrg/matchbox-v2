import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { BorrowView } from "../../data/entities"
import type { Section } from "../../data/explorer"
import type { LockView } from "../../data/scan/lock-views"
import { bandWords } from "../../data/scan/words"
import type { TokenBalances } from "../../data/views"
import { deferred } from "../../shell/deferred"
import { bandTone, lockSubline } from "./shared"
import { figureClass, Tile, TilePlaceholder } from "./tile"
import type { WalletPanels } from "./wallet-panels"

// A lock owner's tiles: their own chunk, off the first paint's budget and
// never loaded for an address without locks.
const RewardsClaimedTile = deferred(() =>
  import("./wallet-tiles").then((module) => module.RewardsClaimedTile),
)
const StreakTile = deferred(() =>
  import("./wallet-tiles").then((module) => module.StreakTile),
)
const VeMezoTile = deferred(() =>
  import("./wallet-tiles").then((module) => module.VeMezoTile),
)
const ClaimableTile = deferred(() =>
  import("./wallet-tiles").then((module) => module.ClaimableTile),
)

/**
 * The address page's tiles (`eSwId--0MF`) whose every input exists, in the
 * design's order: rewards claimed, loan health, the locks' voting streak,
 * veBTC locked, veMEZO votes, claimable, wallet. A lock owner's four
 * wallet tiles (wallet-tiles) always hold their places: placeholders
 * while the panels load after the page, then a figure or the read's
 * state. Two across on a phone. Net worth has no source yet and is left
 * out.
 */

// -- tiles ------------------------------------------------------------------

function LoanTile({ borrow }: { borrow: BorrowView }): ReactNode {
  const trove = borrow.trove
  const morpho = borrow.morpho.find((position) => position.debt !== null)
  if (trove !== null) {
    return (
      <Tile label="Loan health">
        <p className={`${figureClass} ${bandTone[trove.health.band]}`}>
          {trove.collateralRatio ?? trove.health.bandText}
        </p>
        {trove.health.liquidationPrice === null &&
        !trove.health.estimate &&
        trove.health.priceNote === null ? null : (
          <p className="mt-1 text-[15px] text-sec">
            {[
              trove.health.estimate ? "Estimate" : null,
              trove.health.priceNote,
              trove.health.liquidationPrice === null
                ? null
                : `liquidates under ${trove.health.liquidationPrice}`,
            ]
              .filter((part) => part !== null)
              .join(", ")
              .replace(/^l/, "L")}
          </p>
        )}
        <p className="mt-auto pt-3 text-[14.5px] text-sec">
          MUSD loan, {trove.debt}
        </p>
      </Tile>
    )
  }
  if (morpho !== undefined) {
    return (
      <Tile label="Loan health">
        <p className={`${figureClass} ${bandTone[morpho.health.band]}`}>
          {morpho.health.healthFactor ?? bandWords[morpho.health.band]}
        </p>
        {morpho.health.liquidationPrice === null ? null : (
          <p className="mt-1 text-[15px] text-sec">
            Liquidates under {morpho.health.liquidationPrice}
          </p>
        )}
        <p className="mt-auto pt-3 text-[14.5px] text-sec">
          {morpho.market}, LTV {morpho.health.ltv}
        </p>
      </Tile>
    )
  }
  return null
}

function VeBtcTile({ locks }: { locks: readonly LockView[] }): ReactNode {
  const live = locks.filter(
    (lock) =>
      lock.escrow === "vebtc" &&
      (lock.state === "active" || lock.state === "auto-max"),
  )
  const lead = live[0]
  if (lead === undefined) return null
  return (
    <Tile
      label="veBTC locked"
      aside={
        <Link
          to="/locks/$escrow/$id"
          params={{ escrow: "vebtc", id: lead.id }}
          className="rounded-sm font-semibold text-ink outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
        >
          #{lead.id}
        </Link>
      }
    >
      <p className={figureClass}>{lead.amount}</p>
      <p className="mt-1 text-[15px] text-sec">{lockSubline(lead)}</p>
      {live.length > 1 ? (
        <p className="mt-auto pt-3 text-[14.5px] text-sec">
          {live.length} veBTC locks
        </p>
      ) : null}
    </Tile>
  )
}

/** The wallet tile lists this many balances. */
const shownTokens = 4

/**
 * Under the listed balances: how many there are, or, when the address
 * holds more than the first page the API reads (50), that it does.
 */
function TokenCount({ tokens }: { tokens: TokenBalances }): ReactNode {
  const count = tokens.items.length
  if (!tokens.more && count <= shownTokens) return null
  return (
    <p className="mt-auto pt-3 text-[14.5px] text-sec">
      {tokens.more
        ? `${shownTokens} of the first ${count} balances shown. This address holds more.`
        : `${shownTokens} of ${count} balances shown`}
    </p>
  )
}

function WalletTile({
  balance,
  tokens,
}: {
  balance: string | null
  tokens: Section<TokenBalances>
}): ReactNode {
  return (
    <Tile label="Wallet" wide>
      {balance === null ? (
        // The summary could not be read: no balance, never a made-up zero.
        <p className="mt-2 text-[22px] leading-tight font-[650] text-sec">
          Not available
        </p>
      ) : (
        <p className={figureClass}>
          {balance}
          <span className="ml-2 text-[17px] font-normal text-sec">BTC</span>
        </p>
      )}
      {tokens.status === "ok" ? (
        tokens.data.items.length === 0 ? null : (
          <>
            <ul className="mt-3 grid grid-cols-1 gap-y-1.5">
              {tokens.data.items.slice(0, shownTokens).map((token) => (
                <li
                  key={token.address}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 text-[15px]"
                >
                  <Link
                    to="/address/$address"
                    params={{ address: token.address }}
                    className="min-w-0 truncate rounded-sm font-semibold outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <UntrustedText.Root
                      value={token.symbol ?? token.name ?? token.address}
                      limit={16}
                    />
                  </Link>
                  <span className="tabular-nums">{token.amount}</span>
                  {token.usd === null ? null : (
                    <span className="col-span-2 text-right text-[13.5px] whitespace-nowrap text-sec tabular-nums">
                      {token.usd}
                      {token.usdAssumed ? ", $1 assumed" : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <TokenCount tokens={tokens.data} />
          </>
        )
      ) : (
        <p className="mt-3 text-[15px] text-sec" role="status">
          {tokens.status === "rate-limited"
            ? "Busy, try again"
            : "Tokens unavailable"}
        </p>
      )}
    </Tile>
  )
}

/** A wallet tile: its placeholder until the panels and its code arrive. */
function WalletSlot({
  label,
  panels,
  children,
}: {
  label: string
  panels: WalletPanels
  children: (done: Extract<WalletPanels, { status: "done" }>) => ReactNode
}): ReactNode {
  if (panels.status === "none") return null
  if (panels.status === "loading") return <TilePlaceholder label={label} />
  return (
    <Suspense fallback={<TilePlaceholder label={label} />}>
      {children(panels)}
    </Suspense>
  )
}

export function Tiles({
  balance,
  tokens,
  borrow,
  locks,
  panels = { status: "none" },
}: {
  balance: string | null
  tokens: Section<TokenBalances>
  borrow: Section<BorrowView>
  locks: Section<{ items: LockView[]; more: boolean }>
  panels?: WalletPanels
}): ReactNode {
  const owner = panels.status !== "none"
  return (
    <section
      aria-label="Overview"
      className={`mt-8 grid grid-cols-2 gap-4 max-sm:gap-3 ${owner ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}
    >
      <WalletSlot label="Rewards claimed" panels={panels}>
        {(done) => (
          <RewardsClaimedTile wallet={done.wallet} retry={done.retry} />
        )}
      </WalletSlot>
      {borrow.status === "ok" ? <LoanTile borrow={borrow.data} /> : null}
      <WalletSlot label="Locks' voting streak" panels={panels}>
        {(done) => <StreakTile streak={done.streak} retry={done.retry} />}
      </WalletSlot>
      {locks.status === "ok" ? <VeBtcTile locks={locks.data.items} /> : null}
      <WalletSlot label="veMEZO votes" panels={panels}>
        {(done) => <VeMezoTile wallet={done.wallet} retry={done.retry} />}
      </WalletSlot>
      <WalletSlot label="Claimable" panels={panels}>
        {(done) => <ClaimableTile wallet={done.wallet} retry={done.retry} />}
      </WalletSlot>
      <WalletTile balance={balance} tokens={tokens} />
    </section>
  )
}
