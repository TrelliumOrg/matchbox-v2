import { describe, expect, it } from "vitest"
import {
  hoursFrom,
  statusOf,
  stripOf,
  type UptimeDayRow,
  type UptimeHourRow,
  type UptimeStatusRow,
  windowStarts,
  windowsOf,
} from "./uptime-math"

/** Thu 12 Nov 2026 06:40 UTC. */
const now = Date.UTC(2026, 10, 12, 6, 40) / 1000
const hour = now - (now % 3_600)
const validator = "0x3c67d8020bf8aa75542f65e8152f74086be71f20"

function statusRow(overrides: Partial<UptimeStatusRow> = {}): UptimeStatusRow {
  return {
    height: 13171500,
    block_time: now - 30,
    set_id: 1,
    started_time: now - 40 * 86_400,
    finalized_day: "2026-11-11",
    read_at: now - 40,
    source: "pathrock",
    node_height: 13171510,
    evm_height: 13171512,
    health: "ok",
    ...overrides,
  }
}

function hourRow(at: number, signed: number, missed: number): UptimeHourRow {
  return {
    validator,
    hour: at,
    blocks: signed + missed,
    signed,
    missed,
    proposed: 1,
    proposals_missed: 0,
    expected_micro: 47_619 * (signed + missed),
  }
}

function dayRow(
  day: string,
  signed: number,
  missed: number,
  complete = 1,
  key = validator,
): UptimeDayRow {
  return {
    validator: key,
    day,
    blocks: signed + missed,
    signed,
    missed,
    proposed: 10,
    proposals_missed: 1,
    expected_micro: 47_619 * (signed + missed),
    complete,
  }
}

function daysBack(count: number, from = "2026-11-11"): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) =>
    new Date(start - index * 86_400_000).toISOString().slice(0, 10),
  )
}

describe("statusOf", () => {
  it("is live when read lately and close to the head", () => {
    expect(statusOf(statusRow(), now)).toMatchObject({
      state: "live",
      source: "pathrock",
      behind_blocks: 12,
    })
  })

  it("is behind when the counted heights trail the head", () => {
    expect(statusOf(statusRow({ evm_height: 13171800 }), now).state).toBe(
      "behind",
    )
    expect(statusOf(statusRow({ health: "behind" }), now).state).toBe("behind")
    expect(statusOf(statusRow({ block_time: now - 900 }), now).state).toBe(
      "behind",
    )
  })

  it("is down when no run read a node for five minutes", () => {
    expect(statusOf(statusRow({ read_at: now - 400 }), now).state).toBe("down")
  })

  it("is not started before the first height", () => {
    expect(statusOf(null, now).state).toBe("not_started")
    expect(statusOf(statusRow({ height: null }), now).state).toBe("not_started")
  })
})

describe("windowsOf", () => {
  it("sums the hours for 24 hours and 7 days, and the days for 30", () => {
    const hours = [
      hourRow(hour, 900, 0),
      hourRow(hour - 23 * 3_600, 800, 100),
      hourRow(hour - 24 * 3_600, 0, 950),
      hourRow(hour - 167 * 3_600, 950, 0),
    ]
    const days = daysBack(29).map((day) => dayRow(day, 20_000, 2_700))
    const chain = daysBack(29).map((day) => dayRow(day, 0, 0, 1, ""))
    const windows = windowsOf({
      now,
      startedTime: now - 40 * 86_400,
      finalizedDay: "2026-11-11",
      hours,
      days,
      chainDays: chain,
    })
    expect(windows.d1).toMatchObject({
      blocks: 1_800,
      signed: 1_700,
      missed: 100,
      uptime_bps: 9_444,
      complete: true,
      from: hour - 23 * 3_600,
    })
    expect(windows.d7).toMatchObject({ blocks: 3_700, signed: 2_650 })
    // 29 rolled-up days plus today's hour.
    expect(windows.d30).toMatchObject({
      blocks: 29 * 22_700 + 900,
      signed: 29 * 20_000 + 900,
      complete: true,
      from: Date.UTC(2026, 9, 14) / 1000,
    })
  })

  it("says where the counts start when the poller started recently", () => {
    const started = now - 3 * 3_600
    const windows = windowsOf({
      now,
      startedTime: started,
      finalizedDay: null,
      hours: [hourRow(hour, 10, 0)],
      days: [],
      chainDays: [],
    })
    expect(windows.d1).toMatchObject({ complete: false, from: started })
    expect(windows.d30).toMatchObject({ complete: false, from: started })
  })

  it("covers back to the first backfilled day, or the poller's partial day", () => {
    const chain = [
      dayRow("2026-11-11", 0, 0, 1, ""),
      dayRow("2026-11-10", 0, 0, 0, ""),
    ]
    const started = Date.UTC(2026, 10, 10, 15) / 1000
    const windows = windowsOf({
      now,
      startedTime: started,
      finalizedDay: "2026-11-11",
      hours: [],
      days: [],
      chainDays: chain,
    })
    expect(windows.d30).toMatchObject({ complete: false, from: started })
  })

  it("reads hours from the 7-day start, or the day after the last roll-up", () => {
    expect(hoursFrom(now, "2026-11-11")).toBe(windowStarts(now).d7)
    expect(hoursFrom(now, "2026-11-01")).toBe(Date.UTC(2026, 10, 2) / 1000)
  })
})

describe("stripOf", () => {
  it("shows each block as signed, missed or out, with proposals", () => {
    const members = new Map([
      [
        1,
        [
          { c: "A".repeat(40), o: validator, n: "Imperator.co" },
          { c: "B".repeat(40), o: null, n: null },
        ],
      ],
    ])
    const strip = stripOf(
      [
        {
          height: 3,
          time: 30,
          round: 1,
          set_id: 1,
          proposer: 1,
          missed: "0",
          signed: "2",
          signers: 1,
        },
        {
          height: 2,
          time: 20,
          round: 0,
          set_id: 1,
          proposer: 0,
          missed: "",
          signed: "3",
          signers: 2,
        },
        {
          height: 1,
          time: 10,
          round: 0,
          set_id: 9,
          proposer: 0,
          missed: "",
          signed: "1",
          signers: 1,
        },
      ],
      members,
      validator,
    )
    expect(strip).toEqual([
      {
        height: 3,
        time: 30,
        state: "missed",
        proposed: false,
        missed_proposal: true,
      },
      {
        height: 2,
        time: 20,
        state: "signed",
        proposed: true,
        missed_proposal: false,
      },
      {
        height: 1,
        time: 10,
        state: "out",
        proposed: false,
        missed_proposal: false,
      },
    ])
  })
})
