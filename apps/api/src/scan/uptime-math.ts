import type {
  ScanUptimeState,
  ScanUptimeStatus,
  ScanUptimeStripBlock,
  ScanUptimeWindow,
  ScanUptimeWindows,
} from "@matchbox/contracts/scan"
import { z } from "zod"

// Validator uptime from the jobs Worker's tables (scan-migrations 0005):
// how fresh the data is, the 24-hour, 7-day and 30-day windows, and the
// recent-blocks strip. Pure: the route reads the rows.

/** No run read a node for this long: down. */
export const uptimeDownAfterSeconds = 300
/** The counted heights trail the head by more than this: behind. */
export const uptimeMaxBehindBlocks = 150
/** The newest counted block is older than this: behind. */
export const uptimeMaxAgeSeconds = 600

const hourSeconds = 3_600
const daySeconds = 86_400

export const uptimeStatusRowSchema = z.object({
  height: z.number().int().nullable(),
  block_time: z.number().int().nullable(),
  set_id: z.number().int().nullable(),
  started_time: z.number().int().nullable(),
  finalized_day: z.string().nullable(),
  read_at: z.number().int().nullable(),
  source: z.string().nullable(),
  node_height: z.number().int().nullable(),
  evm_height: z.number().int().nullable(),
  health: z.string(),
})
export type UptimeStatusRow = z.infer<typeof uptimeStatusRowSchema>

export const uptimeMemberSchema = z.object({
  c: z.string().regex(/^[0-9A-F]{40}$/),
  o: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/)
    .nullable(),
  n: z.string().nullable(),
})
export type UptimeMember = z.infer<typeof uptimeMemberSchema>
export const uptimeMembersSchema = z.array(uptimeMemberSchema)

export const uptimeBlockRowSchema = z.object({
  height: z.number().int(),
  time: z.number().int(),
  round: z.number().int(),
  set_id: z.number().int(),
  proposer: z.number().int(),
  missed: z.string().nullable(),
  signed: z.string().regex(/^[0-9a-f]*$/),
  signers: z.number().int(),
})
export type UptimeBlockRow = z.infer<typeof uptimeBlockRowSchema>

const countsShape = {
  validator: z.string(),
  blocks: z.number().int(),
  signed: z.number().int(),
  missed: z.number().int(),
  proposed: z.number().int(),
  proposals_missed: z.number().int(),
  expected_micro: z.number().int(),
}
export const uptimeHourRowSchema = z.object({
  ...countsShape,
  hour: z.number().int(),
})
export type UptimeHourRow = z.infer<typeof uptimeHourRowSchema>
export const uptimeDayRowSchema = z.object({
  ...countsShape,
  day: z.iso.date(),
  complete: z.number().int(),
})
export type UptimeDayRow = z.infer<typeof uptimeDayRowSchema>

/** The key a member's counts are kept under (apps/jobs counts.ts). */
export function uptimeKey(member: UptimeMember): string {
  return member.o ?? `cons:${member.c.toLowerCase()}`
}

export function statusOf(
  row: UptimeStatusRow | null,
  now: number,
): ScanUptimeStatus {
  if (row === null || row.height === null) {
    return {
      state: "not_started",
      source: row?.source ?? null,
      height: null,
      block_time: null,
      read_at: row?.read_at ?? null,
      behind_blocks: null,
    }
  }
  const head = row.evm_height ?? row.node_height
  const behind = head === null ? null : Math.max(0, head - row.height)
  const state: ScanUptimeState =
    row.read_at === null || now - row.read_at > uptimeDownAfterSeconds
      ? "down"
      : row.health === "behind" ||
          row.health === "down" ||
          (behind !== null && behind > uptimeMaxBehindBlocks) ||
          row.block_time === null ||
          now - row.block_time > uptimeMaxAgeSeconds
        ? "behind"
        : "live"
  return {
    state,
    source: row.source,
    height: row.height,
    block_time: row.block_time,
    read_at: row.read_at,
    behind_blocks: behind,
  }
}

type Sums = Omit<ScanUptimeWindow, "uptime_bps" | "from" | "complete">

function emptySums(): Sums {
  return {
    blocks: 0,
    signed: 0,
    missed: 0,
    proposed: 0,
    proposals_missed: 0,
    expected_micro: 0,
  }
}

function add(sums: Sums, row: Sums): void {
  sums.blocks += row.blocks
  sums.signed += row.signed
  sums.missed += row.missed
  sums.proposed += row.proposed
  sums.proposals_missed += row.proposals_missed
  sums.expected_micro += row.expected_micro
}

function windowOf(sums: Sums, from: number | null, complete: boolean) {
  return {
    ...sums,
    uptime_bps:
      sums.blocks === 0
        ? null
        : Math.floor((sums.signed * 10_000) / sums.blocks),
    from,
    complete,
  }
}

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 1000
}

function dayOf(time: number): string {
  return new Date(time * 1000).toISOString().slice(0, 10)
}

/** The first hour of the 24-hour and 7-day windows, and the 30-day's day. */
export function windowStarts(now: number) {
  const hour = now - (now % hourSeconds)
  const today = dayOf(now)
  return {
    d1: hour - 23 * hourSeconds,
    d7: hour - 167 * hourSeconds,
    d30Day: dayOf(dayStart(today) - 29 * daySeconds),
  }
}

/**
 * The first hour the hourly rows must be read from: the 7-day window's, or
 * earlier when days after `finalized_day` (not rolled up yet) start
 * before it.
 */
export function hoursFrom(now: number, finalizedDay: string | null): number {
  const starts = windowStarts(now)
  const after =
    finalizedDay === null
      ? dayStart(starts.d30Day)
      : dayStart(finalizedDay) + daySeconds
  return Math.max(dayStart(starts.d30Day), Math.min(starts.d7, after))
}

/**
 * One validator's windows. `hours` and `days` are its own rows; `chainDays`
 * the chain's ('' rows), which say which days were counted completely.
 * The hourly rows start where the poller started (`startedTime`); the daily
 * rows may reach back further (the backfill).
 */
export function windowsOf(input: {
  now: number
  startedTime: number | null
  finalizedDay: string | null
  hours: readonly UptimeHourRow[]
  days: readonly UptimeDayRow[]
  chainDays: readonly UptimeDayRow[]
}): ScanUptimeWindows {
  const starts = windowStarts(input.now)
  const started = input.startedTime
  const hourly = (from: number) => {
    const sums = emptySums()
    for (const row of input.hours) if (row.hour >= from) add(sums, row)
    return windowOf(
      sums,
      started === null ? null : Math.max(from, started),
      started !== null && started <= from,
    )
  }
  // 30 days: rolled-up days through finalized_day, then the hours after.
  const thirty = emptySums()
  const firstDay = starts.d30Day
  const lastRolled =
    input.finalizedDay !== null && input.finalizedDay >= firstDay
      ? input.finalizedDay
      : null
  const hoursAfter =
    lastRolled === null ? dayStart(firstDay) : dayStart(lastRolled) + daySeconds
  for (const row of input.days) {
    if (lastRolled !== null && row.day >= firstDay && row.day <= lastRolled) {
      add(thirty, row)
    }
  }
  for (const row of input.hours) if (row.hour >= hoursAfter) add(thirty, row)
  // Coverage: walk the chain's days back from the last rolled-up one.
  let from: number | null = null
  let complete = false
  if (lastRolled === null) {
    from = started === null ? null : Math.max(dayStart(firstDay), started)
    complete = started !== null && started <= dayStart(firstDay)
  } else {
    const chain = new Map(input.chainDays.map((row) => [row.day, row]))
    let day = lastRolled
    from = hoursAfter
    complete = true
    while (day >= firstDay) {
      const row = chain.get(day)
      if (row === undefined) {
        complete = false
        break
      }
      if (row.complete !== 1) {
        from = Math.max(dayStart(day), started ?? dayStart(day))
        complete = false
        break
      }
      from = dayStart(day)
      day = dayOf(dayStart(day) - daySeconds)
    }
  }
  return {
    d1: hourly(starts.d1),
    d7: hourly(starts.d7),
    d30: windowOf(thirty, from, complete),
  }
}

function bitAt(bitmap: string, index: number): boolean {
  return (
    ((BigInt(`0x${bitmap === "" ? "0" : bitmap}`) >> BigInt(index)) & 1n) === 1n
  )
}

/** One validator's view of the newest blocks, newest first. */
export function stripOf(
  blocks: readonly UptimeBlockRow[],
  membersBySet: ReadonlyMap<number, readonly UptimeMember[]>,
  address: string,
): ScanUptimeStripBlock[] {
  return blocks.map((block) => {
    const members = membersBySet.get(block.set_id) ?? []
    const index = members.findIndex((member) => member.o === address)
    const missed = (block.missed ?? "")
      .split(",")
      .filter((each) => each !== "")
      .map(Number)
    return {
      height: block.height,
      time: block.time,
      state:
        index < 0
          ? ("out" as const)
          : bitAt(block.signed, index)
            ? ("signed" as const)
            : ("missed" as const),
      proposed: index >= 0 && block.proposer === index,
      missed_proposal: index >= 0 && missed.includes(index),
    }
  })
}
