import * as Inspect from "@matchbox/ui/inspect"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type { VoteHistory, VoteSplit } from "../../data/locks"
import {
  Figure,
  GaugeName,
  gaugeText,
  Panel,
  PanelEmpty,
  PanelState,
  shareValue,
} from "./parts"

/**
 * A lock's votes by epoch, each split by gauge (inspectable). The lock
 * page renders it on the server and loads its code after first paint.
 */

const textLink =
  "rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

/** Said where a lock's earlier record is not in the store yet. */
const notIndexed = "Not indexed yet"

export function Votes({
  votes,
  indexed,
}: {
  votes: Section<VoteHistory>
  indexed: boolean
}): ReactNode {
  const splits: VoteSplit[] = votes.status === "ok" ? votes.data.splits : []
  const cut = votes.status === "ok" && votes.data.cut
  Inspect.useInspect(splits.length > 0)
  return (
    <Panel label="Votes by epoch">
      {votes.status !== "ok" ? (
        <PanelState section={votes} />
      ) : splits.length === 0 ? (
        <PanelEmpty>{indexed ? "Not voted" : notIndexed}</PanelEmpty>
      ) : (
        <>
          <Figure
            value={String(splits.length)}
            note={
              cut
                ? splits.length === 1
                  ? "latest epoch voted"
                  : "latest epochs voted"
                : splits.length === 1
                  ? "epoch voted"
                  : "epochs voted"
            }
          />
          {cut ? (
            <p className="mt-1 text-[14.5px] text-sec">
              Older epochs not shown
            </p>
          ) : indexed ? null : (
            <p className="mt-1 text-[14.5px] text-sec">
              Older epochs not indexed yet
            </p>
          )}
          <ul aria-label="Votes by epoch" className="mt-5 flex flex-col gap-4">
            {splits.map((split) => (
              <li key={split.epoch}>
                <p className="flex items-baseline gap-3 text-[15px]">
                  <Link
                    to="/epochs/$epoch"
                    params={{ epoch: String(split.epoch) }}
                    className={`font-semibold ${textLink}`}
                  >
                    Epoch {split.epoch}
                  </Link>
                  {split.carried ? (
                    <span className="text-sec">Carried over</span>
                  ) : null}
                  <span className="ml-auto font-semibold tabular-nums">
                    {split.total}
                  </span>
                </p>
                <p
                  aria-hidden="true"
                  className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
                  {...Inspect.root("items", "tip", false)}
                >
                  {split.parts.map((part, index) => (
                    <span
                      key={part.gauge.address}
                      className={
                        part.gauge.color === null
                          ? index % 2 === 0
                            ? "bg-acc"
                            : "bg-ink"
                          : ""
                      }
                      style={{
                        flexGrow: part.bps,
                        flexBasis: 0,
                        ...(part.gauge.color === null
                          ? {}
                          : { backgroundColor: part.gauge.color }),
                      }}
                      {...Inspect.point({
                        label: gaugeText(part.gauge),
                        value: shareValue({
                          value: part.weight,
                          bps: part.bps,
                        }),
                      })}
                    />
                  ))}
                </p>
                <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[14.5px]">
                  {split.parts.map((part) => (
                    <li key={part.gauge.address} className="text-sec">
                      <Link
                        to="/gauges/$gauge"
                        params={{ gauge: part.gauge.address }}
                        className={`text-ink ${textLink}`}
                      >
                        <GaugeName gauge={part.gauge} />
                      </Link>{" "}
                      {part.weight}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}
