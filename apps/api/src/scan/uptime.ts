import type {
  ScanUptime,
  ScanUptimeStatus,
  ScanUptimeValidator,
  ScanValidatorUptime,
} from "@matchbox/contracts/scan"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import { addressParam, pathParam, queryOf, type ScanContext } from "./context"
import { scanQueries } from "./queries"
import {
  hoursFrom,
  statusOf,
  stripOf,
  type UptimeBlockRow,
  type UptimeDayRow,
  type UptimeHourRow,
  type UptimeMember,
  type UptimeStatusRow,
  uptimeBlockRowSchema,
  uptimeDayRowSchema,
  uptimeHourRowSchema,
  uptimeKey,
  uptimeMembersSchema,
  uptimeStatusRowSchema,
  windowStarts,
  windowsOf,
} from "./uptime-math"

// /internal/scan/uptime and /internal/scan/validators/{address}/uptime:
// validator signing and proposals from the jobs Worker's uptime tables
// (scan-migrations 0005; apps/jobs README "Validator uptime"). Every answer
// carries `status`: which community node the data came from, how fresh it
// is, and `state`, so a page never shows stale figures as current. Before
// the migration is applied the routes answer `not_started`, not an error.
// Cached as `live` (a minute), keyed on the last counted height and the
// minute, since `state` depends on the clock.

const stripLength = 100
const chainKey = ""

function isMissingTable(error: unknown): boolean {
  return /no such table: uptime_/i.test(String(error))
}

function parseRows<T>(schema: z.ZodType<T>, rows: readonly unknown[]): T[] {
  return rows.flatMap((row) => {
    const parsed = schema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
}

const setRowSchema = z.object({ id: z.number().int(), members: z.string() })

function membersOf(
  row: unknown,
): { id: number; members: UptimeMember[] } | null {
  const parsed = setRowSchema.safeParse(row)
  if (!parsed.success) return null
  let json: unknown
  try {
    json = JSON.parse(parsed.data.members)
  } catch {
    return null
  }
  const members = uptimeMembersSchema.safeParse(json)
  return members.success ? { id: parsed.data.id, members: members.data } : null
}

type Base = {
  row: UptimeStatusRow | null
  status: ScanUptimeStatus
  members: UptimeMember[]
}

async function readBase(scan: ScanContext): Promise<Base> {
  const now = scan.nowSeconds()
  try {
    const parsed = uptimeStatusRowSchema.safeParse(
      await scan.first(scanQueries.uptimeStatus, []),
    )
    const row = parsed.success ? parsed.data : null
    const set =
      row?.set_id == null
        ? null
        : membersOf(await scan.first(scanQueries.uptimeSet, [row.set_id]))
    return { row, status: statusOf(row, now), members: set?.members ?? [] }
  } catch (error) {
    if (!isMissingTable(error)) throw error
    return { row: null, status: statusOf(null, now), members: [] }
  }
}

async function readBlocks(
  scan: ScanContext,
  height: number,
  limit: number,
): Promise<{
  blocks: UptimeBlockRow[]
  membersBySet: Map<number, UptimeMember[]>
}> {
  const blocks = parseRows(
    uptimeBlockRowSchema,
    await scan.rows(scanQueries.uptimeBlocks, [height, limit]),
  )
  const ids = [...new Set(blocks.map((block) => block.set_id))]
  const sets = await scan.firstEach(
    scanQueries.uptimeSet,
    ids.map((id) => [id]),
  )
  const membersBySet = new Map<number, UptimeMember[]>()
  for (const row of sets) {
    const set = membersOf(row)
    if (set !== null) membersBySet.set(set.id, set.members)
  }
  return { blocks, membersBySet }
}

function versionOf(scan: ScanContext, base: Base): string {
  return `u${base.row?.height ?? 0}-${base.status.state}-m${Math.floor(scan.nowSeconds() / 60)}`
}

function serve(
  c: ApiContext,
  scan: ScanContext,
  base: Base,
  render: () => Promise<unknown>,
): Promise<Response> {
  const url = new URL(c.req.url)
  return scan.responder.serve(c, {
    cacheClass: "live",
    resource: url.pathname,
    version: versionOf(scan, base),
    caller: callerOf(c),
    render: async () => ({ body: await render() }),
  })
}

function groupBy<Row extends { validator: string }>(
  rows: readonly Row[],
): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>()
  for (const row of rows) {
    const list = grouped.get(row.validator) ?? []
    list.push(row)
    grouped.set(row.validator, list)
  }
  return grouped
}

export function registerScanUptime(app: Hono<ApiEnv>, scan: ScanContext): void {
  app.get("/internal/scan/uptime", (c) => {
    queryOf(c, {})
    return (async () => {
      const base = await readBase(scan)
      return serve(c, scan, base, async (): Promise<ScanUptime> => {
        const row = base.row
        if (row === null || row.height === null) {
          return {
            data: { status: base.status, latest: null, validators: [] },
          }
        }
        const now = scan.nowSeconds()
        const [latestBlocks, hours, days] = await Promise.all([
          readBlocks(scan, row.height, 1),
          scan.rows(scanQueries.uptimeHours, [
            hoursFrom(now, row.finalized_day),
          ]),
          scan.rows(scanQueries.uptimeDays, [windowStarts(now).d30Day]),
        ])
        const hourRows = groupBy(parseRows(uptimeHourRowSchema, hours))
        const dayRows = groupBy(parseRows(uptimeDayRowSchema, days))
        const chainDays = dayRows.get(chainKey) ?? []
        const latest = latestBlocks.blocks[0]
        const latestMembers =
          latest === undefined
            ? []
            : (latestBlocks.membersBySet.get(latest.set_id) ?? [])
        const byKey = new Map(
          base.members.map((member) => [uptimeKey(member), member]),
        )
        const keys = [
          ...new Set([...byKey.keys(), ...hourRows.keys(), ...dayRows.keys()]),
        ]
          .filter((key) => key !== chainKey)
          .sort()
        const validators: ScanUptimeValidator[] = keys.map((key) => {
          const member = byKey.get(key) ?? null
          const consensus = key.startsWith("cons:")
            ? key.slice(5).toUpperCase()
            : (member?.c ?? null)
          return {
            address: key.startsWith("0x") ? key : null,
            consensus,
            moniker: member?.n ?? null,
            in_set: member !== null,
            windows: windowsOf({
              now,
              startedTime: row.started_time,
              finalizedDay: row.finalized_day,
              hours: hourRows.get(key) ?? [],
              days: dayRows.get(key) ?? [],
              chainDays,
            }),
          }
        })
        return {
          data: {
            status: base.status,
            latest:
              latest === undefined
                ? null
                : {
                    height: latest.height,
                    time: latest.time,
                    round: latest.round,
                    signing: latest.signers,
                    of: latestMembers.length,
                  },
            validators,
          },
        }
      })
    })()
  })

  app.get("/internal/scan/validators/:address/uptime", (c) => {
    const address = pathParam(c, "address", addressParam)
    queryOf(c, {})
    return (async () => {
      const base = await readBase(scan)
      return serve(c, scan, base, async (): Promise<ScanValidatorUptime> => {
        const row = base.row
        const member = base.members.find((each) => each.o === address) ?? null
        const empty: ScanValidatorUptime = {
          data: {
            status: base.status,
            address,
            consensus: member?.c ?? null,
            moniker: member?.n ?? null,
            in_set: member !== null,
            windows: null,
            strip: [],
            last_signed: null,
          },
        }
        if (row === null || row.height === null) return empty
        const now = scan.nowSeconds()
        const [recent, hours, days, chainDays, lastHour, lastDay] =
          await Promise.all([
            readBlocks(scan, row.height, stripLength),
            scan.rows(scanQueries.uptimeHoursOf, [
              address,
              hoursFrom(now, row.finalized_day),
            ]),
            scan.rows(scanQueries.uptimeDaysOf, [
              address,
              windowStarts(now).d30Day,
            ]),
            scan.rows(scanQueries.uptimeDaysOf, [
              chainKey,
              windowStarts(now).d30Day,
            ]),
            scan.first(scanQueries.uptimeLastSignedHour, [address]),
            scan.first(scanQueries.uptimeLastSignedDay, [address]),
          ])
        const hourRows: UptimeHourRow[] = parseRows(uptimeHourRowSchema, hours)
        const dayRows: UptimeDayRow[] = parseRows(uptimeDayRowSchema, days)
        const known = hourRows.length > 0 || dayRows.length > 0
        const signedHour = z
          .object({ at: z.number().int().nullable() })
          .safeParse(lastHour)
        const signedDay = z
          .object({ day: z.iso.date().nullable() })
          .safeParse(lastDay)
        const lastSigned =
          signedHour.success && signedHour.data.at !== null
            ? { at: signedHour.data.at, precision: "hour" as const }
            : signedDay.success && signedDay.data.day !== null
              ? {
                  at: Date.parse(`${signedDay.data.day}T00:00:00Z`) / 1000,
                  precision: "day" as const,
                }
              : null
        return {
          data: {
            ...empty.data,
            windows:
              !known && member === null
                ? null
                : windowsOf({
                    now,
                    startedTime: row.started_time,
                    finalizedDay: row.finalized_day,
                    hours: hourRows,
                    days: dayRows,
                    chainDays: parseRows(uptimeDayRowSchema, chainDays),
                  }),
            strip: stripOf(recent.blocks, recent.membersBySet, address),
            last_signed: lastSigned,
          },
        }
      })
    })()
  })
}
