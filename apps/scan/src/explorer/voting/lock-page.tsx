import { shortAddress } from "@matchbox/domain/format"
import { TokenIcon } from "@matchbox/token-icons"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { Section } from "../../data/explorer"
import type { LockPage } from "../../data/locks"
import type { ActivityView } from "../../data/scan/activity-view"
import { deferred } from "../../shell/deferred"
import { escrowName, stateWords } from "../address/shared"
import { SectionState } from "../parts"
import { ActivityList } from "../sentence"
import { EnclaveCollateralChip, EnclavePositionPanel } from "./lock-enclave"
import {
  MatchboxAction,
  Panel,
  PanelEmpty,
  PanelState,
  proOrigin,
} from "./parts"

/**
 * A lock (`bG-Fb-_hxD`), by escrow and id: amount, unlock, voting power,
 * this epoch's votes and boost, its votes by epoch and its history in
 * plain words. Owner, amount, unlock, voting power and this epoch's votes
 * are the chain's (read at most once a minute); a lock the store does not
 * have yet says its history and older votes are not indexed yet.
 * Left out until their data exists: voting power's decay over time, USD
 * values, rewards by epoch (no per-lock rewards route),
 * the Enclave position's live debt with interest and collateral ratio
 * (`ye58XxZO9m`: no job reads live Enclave state; the chip and panel in
 * lock-enclave show its principal, found by veBTC id), Watch, Ask about
 * this.
 */

/** Votes by epoch: its code after first paint. */
const Votes = deferred(() =>
  import("./lock-votes").then((module) => module.Votes),
)

const coins = { vebtc: "BTC", vemezo: "MEZO" } as const

const textLink =
  "rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

export function LockView({ page }: { page: LockPage }): ReactNode {
  const name = escrowName[page.escrow]
  const lock = page.lock.status === "ok" ? page.lock.data : null
  return (
    <>
      <Breadcrumbs.Root className="mt-8 max-xl:mt-5">
        <Breadcrumbs.Item asChild>
          <Link to="/locks">Locks</Link>
        </Breadcrumbs.Item>
        <Breadcrumbs.Item asChild>
          <Link
            to="/locks"
            search={page.escrow === "vemezo" ? { escrow: "vemezo" } : {}}
          >
            {name}
          </Link>
        </Breadcrumbs.Item>
        <Breadcrumbs.Current>#{page.id}</Breadcrumbs.Current>
      </Breadcrumbs.Root>
      <header className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-4">
        <TokenIcon ticker={coins[page.escrow]} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-x-3 text-[40px] leading-tight font-[650] tracking-[-0.02em] max-xl:text-[32px]">
            {name} #{page.id}
            {lock === null ||
            lock.state === "active" ||
            lock.state === "auto-max" ? null : (
              <span className="rounded-full bg-soft px-3 py-1 text-[14px] font-semibold tracking-normal text-ink2">
                {stateWords[lock.state]}
              </span>
            )}
          </h1>
          {lock?.owner === null || lock === null ? null : (
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-sec">
              <span>
                Owned by{" "}
                <Link
                  to="/address/$address"
                  params={{ address: lock.owner }}
                  className={`font-mono text-ink ${textLink}`}
                >
                  {shortAddress(lock.owner)}
                </Link>
              </span>
              <EnclaveCollateralChip enclave={page.enclave} />
            </p>
          )}
        </div>
        <MatchboxAction href={proOrigin} tone="neutral">
          Manage on Matchbox
        </MatchboxAction>
      </header>
      {page.lock.status !== "ok" ? (
        <div className="mt-8">
          <SectionState section={page.lock} />
        </div>
      ) : (
        <dl className="mt-8 grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
          {page.cards.map((card) => (
            <div key={card.label} className="rounded-[24px] bg-soft p-6">
              <dt className="text-[15px] text-ink2">{card.label}</dt>
              <dd className="mt-2 text-[28px] leading-tight font-[650] tracking-[-0.02em] tabular-nums">
                {card.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <EnclavePositionPanel enclave={page.enclave} />
      <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Suspense fallback={null}>
          <Votes votes={page.votes} indexed={page.indexed} />
        </Suspense>
        <History
          activity={page.activity}
          indexed={page.indexed}
          now={page.now}
        />
      </div>
    </>
  )
}

/** Said where a lock's earlier record is not in the store yet. */
const notIndexed = "Not indexed yet"

function History({
  activity,
  indexed,
  now,
}: {
  activity: Section<{ rows: ActivityView[]; more: boolean }>
  indexed: boolean
  now: number
}): ReactNode {
  return (
    <Panel label="History">
      {!indexed ? (
        <PanelEmpty>{notIndexed}</PanelEmpty>
      ) : activity.status !== "ok" ? (
        <PanelState section={activity} />
      ) : activity.data.rows.length === 0 ? (
        <PanelEmpty>No activity</PanelEmpty>
      ) : (
        <div className="mt-2">
          <ActivityList rows={activity.data.rows} now={now} />
          {activity.data.more ? (
            <p className="mt-2 text-[14.5px] text-sec">
              Latest {activity.data.rows.length} shown
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  )
}
