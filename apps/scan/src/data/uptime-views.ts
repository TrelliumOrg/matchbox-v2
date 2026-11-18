import type {
  ScanUptime,
  ScanUptimeStatus,
  ScanUptimeWindow,
  ScanValidatorUptime,
} from "@matchbox/contracts/scan"
import {
  formatDay,
  formatDayTime,
  groupThousands,
} from "@matchbox/domain/format"

/**
 * Validator uptime as the pages show it, from the API's uptime routes
 * (apps/api README "Validator uptime"): figures, the recent-blocks strip
 * and one line saying where the data came from and how fresh it is. Pure,
 * so the views are tested without the API.
 *
 * Figures are shown as current only when the API says `live`. Otherwise
 * the line says why uptime is paused, and the figures say what time they
 * run to, so a stale number never reads as today's.
 */

const nodeNames: Record<string, string> = {
  pathrock: "Pathrock",
  lavender: "Lavender Five",
}

/** "under a minute ago", "2 minutes ago", "3 hours ago". */
export function agoText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return "under a minute ago"
  if (total < 3_600) {
    const minutes = Math.floor(total / 60)
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  }
  if (total < 86_400) {
    const hours = Math.floor(total / 3_600)
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  }
  const days = Math.floor(total / 86_400)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}

export type UptimeFreshness = {
  /** The figures are current. */
  live: boolean
  /** "From a community node (Pathrock), 2 minutes ago", or why paused. */
  line: string
  /** "Fri 13 Nov, 06:38": the newest block counted; null before any. */
  asOf: string | null
}

export function freshnessOf(
  status: ScanUptimeStatus,
  now: number,
): UptimeFreshness {
  const asOf =
    status.block_time === null ? null : formatDayTime(status.block_time)
  const node =
    status.source === null
      ? "a community node"
      : `a community node (${nodeNames[status.source] ?? status.source})`
  switch (status.state) {
    case "live":
      return {
        live: true,
        line: `From ${node}, ${agoText(now - (status.block_time ?? now))}`,
        asOf,
      }
    case "behind":
      return {
        live: false,
        line: "Uptime paused: the node we read is behind",
        asOf,
      }
    case "down":
      return {
        live: false,
        line: "Uptime paused: no community node is answering",
        asOf,
      }
    case "not_started":
      return { live: false, line: "Uptime not counted yet", asOf: null }
  }
}

/** Basis points as "99.99%", rounded down so 99.995% never reads 100%. */
export function uptimeText(bps: number): string {
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}%`
}

function shareText(part: number, whole: number): string | null {
  if (whole <= 0) return null
  return uptimeText(Math.floor((part * 10_000) / whole))
}

/** One window's figures. */
export type UptimeFigures = {
  /** Null when it was in the set for no block of the window. */
  uptime: string | null
  bps: number | null
  blocks: string
  signed: string
  missed: string
  missedCount: number
  proposed: string
  proposalsMissed: string
  /** Its share of the blocks proposed, and the 1/N it would expect. */
  share: string | null
  expected: string | null
  /** "Thu 12 Nov, 04:00": where the counts start, when after the window. */
  since: string | null
}

export function figuresOf(window: ScanUptimeWindow): UptimeFigures {
  const blocks = window.signed + window.missed
  return {
    uptime: window.uptime_bps === null ? null : uptimeText(window.uptime_bps),
    bps: window.uptime_bps,
    blocks: groupThousands(BigInt(blocks)),
    signed: groupThousands(BigInt(window.signed)),
    missed: groupThousands(BigInt(window.missed)),
    missedCount: window.missed,
    proposed: groupThousands(BigInt(window.proposed)),
    proposalsMissed: groupThousands(BigInt(window.proposals_missed)),
    share: shareText(window.proposed, blocks),
    expected: shareText(window.expected_micro, blocks * 1_000_000),
    since:
      window.complete || window.from === null
        ? null
        : formatDayTime(window.from),
  }
}

/** The list's figure per validator, by operator address. */
export type UptimeCell = {
  /** 24 hours. */
  day: UptimeFigures
}

export type UptimeOverview = {
  freshness: UptimeFreshness
  /** The newest counted block's signers, "20 of 21"; null before any. */
  signing: { signing: number; of: number; height: number } | null
  /** By operator address, lower case. */
  byOperator: Record<string, UptimeCell>
}

export function overviewOf(body: ScanUptime, now: number): UptimeOverview {
  const byOperator: Record<string, UptimeCell> = {}
  for (const validator of body.data.validators) {
    if (validator.address === null) continue
    byOperator[validator.address.toLowerCase()] = {
      day: figuresOf(validator.windows.d1),
    }
  }
  const latest = body.data.latest
  return {
    freshness: freshnessOf(body.data.status, now),
    signing:
      latest === null
        ? null
        : { signing: latest.signing, of: latest.of, height: latest.height },
    byOperator,
  }
}

export type StripBlock = {
  height: number
  state: "signed" | "missed" | "out"
  proposed: boolean
  missedProposal: boolean
  /** "13,171,503: missed, its proposal missed". */
  title: string
}

export type ValidatorUptimeView = {
  freshness: UptimeFreshness
  inSet: boolean
  windows: { d1: UptimeFigures; d7: UptimeFigures; d30: UptimeFigures } | null
  /** Oldest first, as read left to right. */
  strip: StripBlock[]
  /** "3 of the last 100 missed". */
  stripSummary: string | null
  /** "Last signed Thu 12 Nov, 04:00" for a validator that is not signing. */
  lastSigned: string | null
}

const stateWords = { signed: "signed", missed: "missed", out: "not in the set" }

export function validatorUptimeOf(
  body: ScanValidatorUptime,
  now: number,
): ValidatorUptimeView {
  const data = body.data
  const strip = [...data.strip].reverse().map((block) => ({
    height: block.height,
    state: block.state,
    proposed: block.proposed,
    missedProposal: block.missed_proposal,
    title: `${groupThousands(BigInt(block.height))}: ${stateWords[block.state]}${block.proposed ? ", proposed it" : ""}${block.missed_proposal ? ", its proposal missed" : ""}`,
  }))
  const inSet = strip.filter((block) => block.state !== "out")
  const missed = inSet.filter((block) => block.state === "missed").length
  const recentlySigned = inSet.some((block) => block.state === "signed")
  return {
    freshness: freshnessOf(data.status, now),
    inSet: data.in_set,
    windows:
      data.windows === null
        ? null
        : {
            d1: figuresOf(data.windows.d1),
            d7: figuresOf(data.windows.d7),
            d30: figuresOf(data.windows.d30),
          },
    strip,
    stripSummary:
      inSet.length === 0
        ? null
        : `${missed} of the last ${inSet.length} missed`,
    lastSigned:
      recentlySigned || inSet.length === 0
        ? null
        : data.last_signed === null
          ? "Not signed in the data kept"
          : `Last signed ${data.last_signed.precision === "hour" ? formatDayTime(data.last_signed.at) : formatDay(data.last_signed.at)}`,
  }
}
