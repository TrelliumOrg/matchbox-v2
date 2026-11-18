import { formatDay } from "@matchbox/domain/format"
import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type { LockEnclaveView } from "../../data/scan/borrow-views"
import { Panel, PanelState } from "./parts"

/**
 * A veBTC lock's Enclave position (`ye58XxZO9m`): the "Enclave
 * collateral" chip beside the owner, and a compact panel with the
 * position's principal, MUSD minted and repaid and when it opened, linking
 * to the position page. Left out until their data exists: the debt with
 * interest, the collateral ratio, its bar and the BTC price the position
 * reaches its minimum at (no job reads live Enclave state).
 */

const linkClass =
  "rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

/** The header chip, only while the lock backs an open position. */
export function EnclaveCollateralChip({
  enclave,
}: {
  enclave: Section<LockEnclaveView | null> | null
}): ReactNode {
  if (enclave?.status !== "ok" || enclave.data?.backing !== true) return null
  return (
    <Link
      to="/borrow/enclaves/$position"
      params={{ position: enclave.data.positionId }}
      title={`Backs ${enclave.data.principal ?? "an Enclave position"}`}
      className={`inline-flex items-center gap-1.5 font-semibold text-ink ${linkClass}`}
    >
      <Glyph shape={shapes.landmark} size={16} strokeWidth={2} />
      Enclave collateral
      <Glyph shape={shapes.chevronRight} size={14} strokeWidth={2} />
    </Link>
  )
}

function Figure({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-[14px] text-sec">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-semibold tabular-nums">
        {children}
      </dd>
    </div>
  )
}

/** The panel, when the lock has ever been pledged to a position. */
export function EnclavePositionPanel({
  enclave,
}: {
  enclave: Section<LockEnclaveView | null> | null
}): ReactNode {
  if (enclave === null) return null
  if (enclave.status !== "ok") {
    return (
      <Panel label="Enclave position" className="mt-4">
        <PanelState section={enclave} />
      </Panel>
    )
  }
  const position = enclave.data
  if (position === null) return null
  return (
    <Panel
      label="Enclave position"
      className="mt-4"
      aside={
        <Link
          to="/borrow/enclaves/$position"
          params={{ position: position.positionId }}
          className="rounded-sm text-[15px] font-semibold text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          View position
        </Link>
      }
    >
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <TokenIcon ticker="MUSD" size={28} />
        <span className="text-[34px] leading-tight font-[650] tracking-[-0.02em] tabular-nums max-md:text-[28px]">
          {position.principal ?? "None"}
        </span>
        <span className="text-[15px] text-sec">
          {position.backing
            ? "principal"
            : position.open
              ? "released"
              : "closed"}
        </span>
      </p>
      <dl className="mt-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <Figure label="Position">
          <span className="font-mono text-[15px]" title={position.positionId}>
            {position.short}
          </span>
        </Figure>
        <Figure label="Minted">{position.minted ?? "None"}</Figure>
        <Figure label="Repaid">{position.repaid ?? "None"}</Figure>
        <Figure label={position.open ? "Since" : position.latestAction}>
          {formatDay(
            position.open
              ? (position.openedAt ?? position.latestAt)
              : position.latestAt,
          )}
        </Figure>
      </dl>
    </Panel>
  )
}
