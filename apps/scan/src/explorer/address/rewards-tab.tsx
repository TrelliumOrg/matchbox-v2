import { formatDate, shortHash } from "@matchbox/domain/format"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { WalletView } from "../../data/wallet-views"
import { Panel, PanelState } from "../voting/parts"
import { RewardsPanel } from "./rewards-chart"
import type { RewardsRange } from "./rewards-range"
import { escrowName } from "./shared"
import { useAddressWallet, type WalletPanels } from "./wallet-panels"
import { proRewardsUrl } from "./wallet-tiles"

/**
 * The address page's Rewards (`eSwId--0MF`): rewards by epoch, what each
 * lock can claim now, and every claim, newest first. Claiming is on
 * Matchbox Pro.
 */

/**
 * Rewards by epoch, its placeholder while the panels load (the height of
 * a drawn chart), or its read's state in the panel.
 */
export function WalletRewardsPanel({
  panels,
  range,
}: {
  panels: Exclude<WalletPanels, { status: "none" }>
  range: RewardsRange
}): ReactNode {
  if (panels.status === "loading") {
    return (
      <Panel label="Rewards by epoch" className="mt-12 min-h-[420px]">
        <span
          aria-hidden="true"
          className="mt-3 block h-[300px] rounded-[16px] bg-skel"
        />
        <span className="sr-only" role="status">
          Loading
        </span>
      </Panel>
    )
  }
  const wallet = panels.wallet
  if (wallet.status !== "ok") {
    return (
      <Panel label="Rewards by epoch" className="mt-12 min-h-[420px]">
        <PanelState section={wallet} />
        {panels.retry === null ? null : (
          <button
            type="button"
            onClick={panels.retry}
            className="self-center rounded-sm text-[14.5px] font-semibold underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            Retry
          </button>
        )}
      </Panel>
    )
  }
  return (
    <RewardsPanel
      wallet={wallet.data}
      range={range}
      current={wallet.data.current}
    />
  )
}

function Tokens({
  tokens,
}: {
  tokens: readonly { symbol: string; amount: string }[]
}): ReactNode {
  return tokens.length === 0
    ? "No tokens"
    : tokens.map((token) => `${token.amount} ${token.symbol}`).join(", ")
}

function ClaimableLocks({ wallet }: { wallet: WalletView }): ReactNode {
  if (wallet.byLock.length === 0) return null
  return (
    <section aria-label="Claimable" className="mt-12">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] text-ink2">
          Claimable
          {(wallet.claimable?.epoch ?? null) === null
            ? null
            : `, Epoch ${wallet.claimable?.epoch} votes`}
        </h2>
        <a
          href={proRewardsUrl}
          className="inline-flex items-center gap-1 rounded-sm text-[15px] font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
        >
          Claim on Matchbox
          <Glyph shape={shapes.arrowUpRight} size={15} strokeWidth={2} />
        </a>
      </div>
      <ListRow.List aria-label="Claimable by lock">
        {wallet.byLock.map((lock) => (
          <ListRow.Root key={`${lock.escrow}:${lock.id}`}>
            <ListRow.Icon>
              <Glyph shape={shapes.lock} size={18} strokeWidth={1.8} />
            </ListRow.Icon>
            <ListRow.Text>
              <ListRow.Title>
                <Link
                  to="/locks/$escrow/$id"
                  params={{ escrow: lock.escrow, id: lock.id }}
                  className="rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                >
                  {escrowName[lock.escrow]} #{lock.id}
                </Link>
              </ListRow.Title>
              <ListRow.Subline>
                <Tokens tokens={lock.tokens} />
              </ListRow.Subline>
            </ListRow.Text>
            <ListRow.Value>
              <ListRow.Main>{lock.usd}</ListRow.Main>
            </ListRow.Value>
          </ListRow.Root>
        ))}
      </ListRow.List>
    </section>
  )
}

function Claims({ wallet }: { wallet: WalletView }): ReactNode {
  return (
    <section aria-label="Claims" className="mt-12">
      <h2 className="text-[15px] text-ink2">Claims</h2>
      {wallet.claims.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-sec">No claims</p>
      ) : (
        <ListRow.List aria-label="Claims">
          {wallet.claims.map((claim) => (
            <ListRow.Root key={`${claim.txHash}:${claim.epoch}`}>
              <ListRow.Icon>
                <Glyph shape={shapes.coins} size={18} strokeWidth={1.8} />
              </ListRow.Icon>
              <ListRow.Text>
                <ListRow.Title>
                  Claimed {claim.usd},{" "}
                  <Link
                    to="/epochs/$epoch"
                    params={{ epoch: String(claim.epoch) }}
                    className="rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    Epoch {claim.epoch}
                  </Link>
                </ListRow.Title>
                <ListRow.Subline>
                  <Tokens tokens={claim.tokens} />
                </ListRow.Subline>
              </ListRow.Text>
              <ListRow.Value>
                <ListRow.Main>{formatDate(claim.claimedAt)}</ListRow.Main>
                <Link
                  to="/tx/$hash"
                  params={{ hash: claim.txHash }}
                  className="mt-0.5 rounded-sm font-mono text-[14px] text-sec outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                >
                  {shortHash(claim.txHash)}
                </Link>
              </ListRow.Value>
            </ListRow.Root>
          ))}
        </ListRow.List>
      )}
    </section>
  )
}

export function RewardsTab({ range }: { range: RewardsRange }): ReactNode {
  const panels = useAddressWallet()
  if (panels.status === "none") return null
  return (
    <>
      <WalletRewardsPanel panels={panels} range={range} />
      {panels.status === "done" && panels.wallet.status === "ok" ? (
        <>
          <ClaimableLocks wallet={panels.wallet.data} />
          <Claims wallet={panels.wallet.data} />
        </>
      ) : null}
    </>
  )
}
