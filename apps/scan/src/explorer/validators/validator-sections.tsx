import * as UntrustedText from "@matchbox/ui/untrusted-text"
import type { ReactNode } from "react"
import type { ValidatorHeader, ValidatorPage } from "../../data/validators"
import { SectionHeading } from "../parts"
import { IncentivesCard, VotesCard, WhoCard } from "../voting/gauge-cards"
import { Deposits, Voters } from "../voting/gauge-lists"
import { EpochFigurePanel } from "../voting/paid-panel"
import { NotYetPanel } from "./parts"
import { reasons } from "./status"
import { UptimePanel } from "./uptime-panel"

/**
 * A validator page's sections below its key figures, a chunk of their own
 * (the page loads it lazily, server rendered all the same): uptime from
 * CometBFT commit signatures (uptime-panel), the MEZO its gauge was
 * distributed per epoch (claims are not indexed, so nothing says what is
 * unclaimed), the gauge's votes and incentives per epoch, who votes and
 * its deposits.
 */

export function ValidatorSections({
  page,
  header,
}: {
  page: ValidatorPage
  header: ValidatorHeader | null
}): ReactNode {
  const gauge = page.gauge
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <UptimePanel uptime={page.uptime} />
        {gauge === null ? null : <VotesCard votes={gauge.votes} unit="veBTC" />}
        {page.emissions === null ? (
          <NotYetPanel
            label="Emissions earned and claimed"
            reason={`${reasons.unclaimed}.`}
          />
        ) : (
          <EmissionsPanel emissions={page.emissions} />
        )}
        {gauge === null ? null : (
          <IncentivesCard incentives={gauge.incentives} />
        )}
      </div>
      {gauge === null || header === null ? null : (
        <section aria-labelledby="who-votes" className="mt-12">
          <SectionHeading id="who-votes">
            Who votes for{" "}
            {header.name === null ? (
              "this validator"
            ) : (
              <UntrustedText.Root value={header.name} limit={32} />
            )}
          </SectionHeading>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-x-10 gap-y-6 max-lg:grid-cols-1">
            <WhoCard who={gauge.who} epoch={page.epoch.number} />
            <Voters voters={gauge.voters} />
          </div>
        </section>
      )}
      {gauge === null ? null : (
        <section aria-labelledby="deposits" className="mt-12 min-w-0">
          <SectionHeading id="deposits">Incentive deposits</SectionHeading>
          <Deposits deposits={gauge.deposits} now={page.now} />
        </section>
      )}
    </>
  )
}

/** MEZO the validators voter distributed to the gauge, per epoch. */
function EmissionsPanel({
  emissions,
}: {
  emissions: NonNullable<ValidatorPage["emissions"]>
}): ReactNode {
  return (
    <EpochFigurePanel
      label="Emissions earned per epoch"
      section={emissions}
      empty="No emissions yet"
    />
  )
}
