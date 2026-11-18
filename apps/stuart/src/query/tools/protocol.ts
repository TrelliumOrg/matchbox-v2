import type { Evidence, Fact } from "@matchbox/stuart-ui/contract"
import { z } from "zod"
import {
  displayBlock,
  displayToken,
  displayUsd,
  tokenAmount,
  usd6,
} from "../format"
import { makeEvidence, makeFact, type ToolOutcome, traceItem } from "../outcome"
import { type PriceSnapshot, priceMicroUsd } from "../providers/prices"
import type { ProtocolSnapshot } from "../providers/protocol"
import {
  errorOutcome,
  priceEvidence,
  snapshotLabel,
  sourceCluster,
} from "./common"
import { defineTool } from "./tool"

// Protocol-wide totals: what is locked in veMEZO and veBTC, how many wallets
// lock MEZO, this epoch's voting incentives, the epoch clock and the
// reference prices. Never wallet-specific.

export const PROTOCOL_TOPICS = [
  "locked",
  "lockers",
  "incentives",
  "epoch",
  "prices",
  "overview",
] as const

export type ProtocolTopic = (typeof PROTOCOL_TOPICS)[number]

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** Unix seconds to "Thu 12 Nov 2026 00:00 UTC". */
export function displayUtc(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  const hours = String(date.getUTCHours()).padStart(2, "0")
  const minutes = String(date.getUTCMinutes()).padStart(2, "0")
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${hours}:${minutes} UTC`
}

/** A sub-dollar price keeps six decimals ("$0.004061"); others get cents. */
export function displayPrice(micro: bigint | null): string {
  if (micro === null) return "Unpriced"
  if (micro >= 1_000_000n) return displayUsd(micro)
  return `$${usd6(micro).replace(/0+$/, "").replace(/\.$/, ".00")}`
}

function evidenceFor(
  scope: Parameters<typeof makeEvidence>[0]["scope"],
  snapshot: ProtocolSnapshot,
  prices: PriceSnapshot,
): Evidence[] {
  const escrows =
    snapshot.lockedSource === "chain"
      ? makeEvidence({
          scope,
          key: "escrows",
          kind: "chain",
          label: "veMEZO and veBTC escrows",
          source: "VotingEscrow supply() and totalVotingPower()",
          blockNumber: snapshot.blockNumber.toString(),
          epoch: snapshot.epoch.number,
          fetchedAt: snapshot.fetchedAt,
          status: "live",
        })
      : makeEvidence({
          scope,
          key: "escrows",
          kind: "indexer",
          label: "Lock totals, warehouse",
          source: "Matchbox summary (chain read unavailable)",
          blockNumber: snapshot.summaryBlock.toString(),
          epoch: snapshot.epoch.number,
          fetchedAt: snapshot.summaryUpdatedAt,
          status: "stale",
        })
  return [
    escrows,
    makeEvidence({
      scope,
      key: "summary",
      kind: "indexer",
      label: "Protocol summary",
      source: "Matchbox summary: lockers, incentives, gauges",
      blockNumber: snapshot.summaryBlock.toString(),
      epoch: snapshot.epoch.number,
      fetchedAt: snapshot.summaryUpdatedAt,
      status: "live",
    }),
    priceEvidence(scope, prices, "both"),
  ]
}

export const protocolStatsTool = defineTool({
  name: "get_protocol_stats",
  family: "protocol",
  description:
    "Protocol-wide Mezo Earn totals, never wallet-specific: MEZO locked in veMEZO and BTC locked in veBTC (on chain), veMEZO voting power, number of veMEZO lockers, this epoch's total voting incentives and funded gauge count, the epoch number and when it ends, and the MEZO and BTC reference prices. topic picks the lead sentence.",
  input: z.object({ topic: z.enum(PROTOCOL_TOPICS) }),
  async run(context, input) {
    const tool = "get_protocol_stats"
    const { scope } = context
    const title = "Mezo Earn totals"
    try {
      const [snapshot, prices] = await Promise.all([
        context.providers.protocol(),
        context.providers.prices(),
      ])
      const evidence = evidenceFor(scope, snapshot, prices)
      const [escrowRef = "", summaryRef = "", priceRef = ""] = evidence.map(
        (item) => item.id,
      )
      const fact = (
        key: string,
        label: string,
        value: Fact["value"],
        display: string,
        refs: string[],
        status: Fact["status"] = "live",
      ) =>
        makeFact({
          scope,
          key,
          label,
          value,
          display,
          status,
          evidenceRefs: refs,
        })
      const lockedStatus = snapshot.lockedSource === "chain" ? "live" : "stale"
      const vemezo = tokenAmount(snapshot.vemezoLocked, 18, "MEZO")
      const vebtc = tokenAmount(snapshot.vebtcLocked, 18, "BTC")
      const mezoMicro = priceMicroUsd(prices.mezo.priceUsd)
      const btcMicro = priceMicroUsd(prices.btc.priceUsd)
      const epochEnd = displayUtc(snapshot.epoch.end)
      const facts: Fact[] = [
        fact(
          "vemezo_locked",
          "MEZO locked in veMEZO",
          { kind: "token", amount: vemezo },
          displayToken(vemezo),
          [escrowRef],
          lockedStatus,
        ),
        fact(
          "vebtc_locked",
          "BTC locked in veBTC",
          { kind: "token", amount: vebtc },
          displayToken(vebtc),
          [escrowRef],
          lockedStatus,
        ),
        fact(
          "lockers",
          "veMEZO lockers",
          { kind: "count", count: snapshot.vemezoLockers },
          snapshot.vemezoLockers.toLocaleString("en-US"),
          [summaryRef],
        ),
        fact(
          "epoch",
          "Epoch",
          { kind: "count", count: snapshot.epoch.number },
          String(snapshot.epoch.number),
          [summaryRef],
        ),
        fact(
          "epoch_end",
          "Epoch ends",
          { kind: "text", text: epochEnd },
          epochEnd,
          [summaryRef],
        ),
        fact(
          "funded",
          "Funded gauges this epoch",
          { kind: "count", count: snapshot.fundedCount },
          String(snapshot.fundedCount),
          [summaryRef],
        ),
        fact(
          "gauges",
          "Gauges",
          { kind: "count", count: snapshot.gaugeCount },
          String(snapshot.gaugeCount),
          [summaryRef],
        ),
        fact(
          "mezo_price",
          "MEZO price",
          mezoMicro === null
            ? { kind: "text", text: "Unpriced" }
            : { kind: "usd", usd: usd6(mezoMicro) },
          displayPrice(mezoMicro),
          [priceRef],
          mezoMicro === null ? "unpriced" : "live",
        ),
        fact(
          "btc_price",
          "BTC price",
          btcMicro === null
            ? { kind: "text", text: "Unpriced" }
            : { kind: "usd", usd: usd6(btcMicro) },
          displayPrice(btcMicro),
          [priceRef],
          btcMicro === null ? "unpriced" : "live",
        ),
      ]
      if (snapshot.vemezoVotingPower !== null) {
        const power = tokenAmount(snapshot.vemezoVotingPower, 18, "veMEZO")
        facts.push(
          fact(
            "vemezo_power",
            "veMEZO voting power",
            { kind: "token", amount: power },
            displayToken(power),
            [escrowRef],
          ),
        )
      }
      if (snapshot.incentivesMicroUsd !== null) {
        facts.push(
          fact(
            "incentives",
            "Incentives this epoch",
            { kind: "usd", usd: usd6(snapshot.incentivesMicroUsd) },
            displayUsd(snapshot.incentivesMicroUsd),
            [summaryRef],
          ),
        )
      }
      if (snapshot.previousIncentivesMicroUsd !== null) {
        facts.push(
          fact(
            "incentives_prev",
            "Incentives last epoch",
            { kind: "usd", usd: usd6(snapshot.previousIncentivesMicroUsd) },
            displayUsd(snapshot.previousIncentivesMicroUsd),
            [summaryRef],
          ),
        )
      }
      const byKey = new Map(
        facts.map((item) => [item.id.slice(scope.prefix.length + 1), item]),
      )
      const show = (key: string) => byKey.get(key)?.display ?? ""
      const incentives = byKey.get("incentives")
      const previous = byKey.get("incentives_prev")
      const lines: Record<ProtocolTopic, { text: string; keys: string[] }> = {
        locked: {
          text: `${show("vemezo_locked")} is locked in veMEZO by ${show("lockers")} lockers, and ${show("vebtc_locked")} in veBTC.`,
          keys: ["vemezo_locked", "lockers", "vebtc_locked"],
        },
        lockers: {
          text: `${show("lockers")} wallets hold veMEZO locks, with ${show("vemezo_locked")} locked.`,
          keys: ["lockers", "vemezo_locked"],
        },
        incentives: incentives
          ? {
              text: `Epoch ${show("epoch")} carries ${incentives.display} in voting incentives across ${show("funded")} funded gauges${previous ? `, against ${previous.display} last epoch` : ""}.`,
              keys: ["epoch", "incentives", "funded", "incentives_prev"],
            }
          : {
              text: `Epoch ${show("epoch")} has ${show("funded")} funded gauges.`,
              keys: ["epoch", "funded"],
            },
        epoch: {
          text: `Epoch ${show("epoch")} ends ${epochEnd}.`,
          keys: ["epoch", "epoch_end"],
        },
        prices: {
          text: `MEZO ${show("mezo_price")}, BTC ${show("btc_price")}.`,
          keys: ["mezo_price", "btc_price"],
        },
        overview: {
          text: `${show("vemezo_locked")} locked in veMEZO and ${show("vebtc_locked")} in veBTC. Epoch ${show("epoch")} ends ${epochEnd}.`,
          keys: ["vemezo_locked", "vebtc_locked", "epoch", "epoch_end"],
        },
      }
      const lead = lines[input.topic]
      return {
        tool,
        intent: "protocol_stats",
        status: "ok",
        title,
        snapshot: {
          blockNumber: snapshot.blockNumber,
          epoch: snapshot.epoch.number,
          label: snapshotLabel({
            blockNumber: snapshot.blockNumber,
            epochStart: BigInt(snapshot.epoch.start),
          }),
        },
        answer: {
          kind: "result",
          templateId: `get_protocol_stats.${input.topic}.v1`,
          text: lead.text,
          factRefs: lead.keys.flatMap((key) => {
            const item = byKey.get(key)
            return item ? [item.id] : []
          }),
        },
        why: null,
        facts,
        evidence,
        blocks: [sourceCluster(scope, evidence)],
        proposals: [],
        followups: [],
        trace: [
          traceItem({
            scope,
            key: "protocol",
            label: `Read protocol totals at block ${displayBlock(snapshot.blockNumber)}`,
            tool,
          }),
        ],
        model: {
          rows: facts.map((item) => ({
            metric: item.label,
            value: item.display,
          })),
          notes: [
            snapshot.lockedSource === "chain"
              ? "Locked totals are the escrows' on-chain supply."
              : "Locked totals come from the warehouse because the chain read failed.",
          ],
        },
        surface: "rail",
        checked: ["protocol totals", "prices"],
      } satisfies ToolOutcome
    } catch {
      return errorOutcome({ scope, tool, intent: "protocol_stats", title })
    }
  },
})
