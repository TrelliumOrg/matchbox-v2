import * as DataTable from "@matchbox/ui/data-table"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { BorrowView } from "../../data/entities"
import type { Section } from "../../data/explorer"
import type { LockView } from "../../data/scan/lock-views"
import { bandWords, type HealthBand } from "../../data/scan/words"
import { SectionState } from "../parts"
import {
  actionLink,
  bandTone,
  escrowName,
  lockSubline,
  stateWords,
} from "./shared"

/** Positions (`eSwId--0MF`): open loans and locks from the composed document. */

// -- positions --------------------------------------------------------------

function PositionIcon({ shape }: { shape: GlyphShape }): ReactNode {
  return (
    <span className="grid size-10 flex-none place-items-center rounded-full bg-soft text-ink">
      <Glyph shape={shape} size={18} strokeWidth={1.8} />
    </span>
  )
}

function Title({
  icon,
  title,
  subline,
}: {
  icon: GlyphShape
  title: ReactNode
  subline: ReactNode
}): ReactNode {
  return (
    <span className="flex items-center gap-3">
      <PositionIcon shape={icon} />
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-[14.5px] text-sec">{subline}</span>
      </span>
    </span>
  )
}

function Health({
  band,
  text,
  words = bandWords[band],
  estimate = false,
  note = null,
}: {
  band: HealthBand
  text: string | null
  /** The band in words, when it says more than the band ("Price out of date"). */
  words?: string
  /** Valued at the market BTC price, not MUSD's price feed. */
  estimate?: boolean
  /** Why there is no band (a stale price), shown after it. */
  note?: string | null
}): ReactNode {
  return (
    <span className="flex flex-col">
      <span className={`font-semibold tabular-nums ${bandTone[band]}`}>
        {text ?? words}
      </span>
      <span className="text-[14.5px] text-sec">
        {words}
        {estimate ? ", estimate" : ""}
        {note === null ? "" : `, ${note}`}
      </span>
    </span>
  )
}

export function Positions({
  address,
  locks,
  borrow,
}: {
  address: string
  locks: Section<{ items: LockView[]; more: boolean }>
  borrow: Section<BorrowView>
}): ReactNode {
  const loans = borrow.status === "ok" ? borrow.data : null
  const lockItems = locks.status === "ok" ? locks.data.items : []
  const empty =
    lockItems.length === 0 &&
    (loans === null ||
      (loans.trove === null &&
        loans.morpho.length === 0 &&
        loans.enclave.length === 0))
  return (
    <>
      {locks.status === "ok" && borrow.status === "ok" && empty ? (
        <p className="py-10 text-center text-[15px] text-sec">No positions</p>
      ) : (
        <DataTable.Root caption="Positions" captionHidden reflow="xl">
          <DataTable.Header>
            <DataTable.Column>Position</DataTable.Column>
            <DataTable.Column>Amount</DataTable.Column>
            <DataTable.Column>Detail</DataTable.Column>
            <DataTable.Column>Health</DataTable.Column>
            <DataTable.Column align="end">
              <span className="sr-only">Open</span>
            </DataTable.Column>
          </DataTable.Header>
          <DataTable.Body>
            {loans?.trove === null || loans === null ? null : (
              <DataTable.Row>
                <DataTable.Cell phone="title">
                  <Title
                    icon={shapes.creditCard}
                    title="MUSD loan"
                    subline="MUSD borrowing"
                  />
                </DataTable.Cell>
                <DataTable.Cell phone="detail">
                  <span className="flex flex-col tabular-nums">
                    <span className="font-semibold">
                      {loans.trove.collateral}
                    </span>
                    <span className="text-[14.5px] text-sec">
                      {loans.trove.debt} debt
                    </span>
                  </span>
                </DataTable.Cell>
                <DataTable.Cell>{loans.trove.rate}</DataTable.Cell>
                <DataTable.Cell phone="value">
                  <Health
                    band={loans.trove.health.band}
                    text={loans.trove.collateralRatio}
                    words={loans.trove.health.bandText}
                    estimate={loans.trove.health.estimate}
                    note={loans.trove.health.priceNote}
                  />
                </DataTable.Cell>
                <DataTable.Cell align="end" phone="meta">
                  <Link
                    to="/borrow/troves/$owner"
                    params={{ owner: address }}
                    className={actionLink}
                  >
                    View loan
                    <Glyph
                      shape={shapes.chevronRight}
                      size={16}
                      strokeWidth={2}
                    />
                  </Link>
                </DataTable.Cell>
              </DataTable.Row>
            )}
            {(loans?.morpho ?? []).map((position) => (
              <DataTable.Row key={position.marketId}>
                <DataTable.Cell phone="title">
                  <Title
                    icon={shapes.creditCard}
                    title={position.market}
                    subline="Morpho Blue"
                  />
                </DataTable.Cell>
                <DataTable.Cell phone="detail">
                  <span className="flex flex-col tabular-nums">
                    <span className="font-semibold">
                      {position.collateral ?? "Collateral"}
                    </span>
                    <span className="text-[14.5px] text-sec">
                      {position.debt === null ? "" : `${position.debt} debt`}
                    </span>
                  </span>
                </DataTable.Cell>
                <DataTable.Cell>
                  {position.health.ltv === null
                    ? null
                    : `LTV ${position.health.ltv}`}
                </DataTable.Cell>
                <DataTable.Cell phone="value">
                  <Health
                    band={position.health.band}
                    text={position.health.healthFactor}
                  />
                </DataTable.Cell>
                <DataTable.Cell align="end" phone="meta">
                  <Link
                    to="/borrow/markets/$market/$account"
                    params={{ market: position.marketId, account: address }}
                    className={actionLink}
                  >
                    View position
                    <Glyph
                      shape={shapes.chevronRight}
                      size={16}
                      strokeWidth={2}
                    />
                  </Link>
                </DataTable.Cell>
              </DataTable.Row>
            ))}
            {(loans?.enclave ?? []).map((position) => (
              <DataTable.Row key={position.positionId}>
                <DataTable.Cell phone="title">
                  <Title
                    icon={shapes.shieldCheck}
                    title="Enclave position"
                    subline={
                      position.pledged.length === 0
                        ? "Enclave"
                        : `veBTC #${position.pledged.join(", #")} pledged`
                    }
                  />
                </DataTable.Cell>
                <DataTable.Cell phone="detail">
                  <span className="flex flex-col tabular-nums">
                    <span className="font-semibold">
                      {position.principal ?? ""}
                    </span>
                    <span className="text-[14.5px] text-sec">Opened with</span>
                  </span>
                </DataTable.Cell>
                <DataTable.Cell>{position.rate}</DataTable.Cell>
                <DataTable.Cell phone="value">
                  <span className="flex flex-col">
                    <span className="font-semibold">
                      Min {position.minimumRatio}
                    </span>
                    <span className="text-[14.5px] text-sec">
                      Warning {position.warningRatio}
                    </span>
                  </span>
                </DataTable.Cell>
                <DataTable.Cell align="end" phone="meta">
                  <Link
                    to="/borrow/enclaves/$position"
                    params={{ position: position.positionId }}
                    className={actionLink}
                  >
                    View position
                    <Glyph
                      shape={shapes.chevronRight}
                      size={16}
                      strokeWidth={2}
                    />
                  </Link>
                </DataTable.Cell>
              </DataTable.Row>
            ))}
            {lockItems.map((lock) => (
              <DataTable.Row key={`${lock.escrowAddress}:${lock.id}`}>
                <DataTable.Cell phone="title">
                  <Title
                    icon={shapes.lock}
                    title={`${lock.escrow === null ? "Lock" : escrowName[lock.escrow]} #${lock.id}`}
                    subline={
                      lock.escrow === "vebtc"
                        ? "Validator and pool voting"
                        : "Gauge voting"
                    }
                  />
                </DataTable.Cell>
                <DataTable.Cell phone="detail">
                  <span className="font-semibold tabular-nums">
                    {lock.amount}
                  </span>
                </DataTable.Cell>
                <DataTable.Cell>{lockSubline(lock)}</DataTable.Cell>
                <DataTable.Cell phone="value">
                  <span className="flex flex-col">
                    <span className="font-semibold">
                      {stateWords[lock.state]}
                    </span>
                    {lock.boost === null ? null : (
                      <span className="text-[14.5px] text-sec">
                        {lock.boost} boost
                      </span>
                    )}
                  </span>
                </DataTable.Cell>
                <DataTable.Cell align="end" phone="meta">
                  {lock.escrow === null ? null : (
                    <Link
                      to="/locks/$escrow/$id"
                      params={{ escrow: lock.escrow, id: lock.id }}
                      className={actionLink}
                    >
                      View lock
                      <Glyph
                        shape={shapes.chevronRight}
                        size={16}
                        strokeWidth={2}
                      />
                    </Link>
                  )}
                </DataTable.Cell>
              </DataTable.Row>
            ))}
          </DataTable.Body>
        </DataTable.Root>
      )}
      {borrow.status === "ok" ? null : (
        <div className="mt-4">
          <SectionState section={borrow} />
        </div>
      )}
      {locks.status === "ok" ? null : (
        <div className="mt-4">
          <SectionState section={locks} />
        </div>
      )}
      {locks.status === "ok" && locks.data.more ? (
        <p className="mt-3 text-[14.5px] text-sec">More locks not shown</p>
      ) : null}
    </>
  )
}
