import type {
  ColumnView,
  LockDistributionView,
  LockPanelView,
  VoterEscrow,
} from "./governance-views"
import type { RewardStat } from "./rewards"

/**
 * The lock panels as the Locks loader sends them: one string. The page's
 * serialized data counts toward its first-paint budget, and every object
 * or array in it costs a reference of its own, so the panels travel as
 * lines of `|`-separated fields and `;`-separated records, which the
 * panels' (deferred) code decodes. No value written here holds `|`, `;`
 * or a newline: labels, amounts and dates only (checked on encode).
 */
export type LockDistributionWire = string

const tones: readonly ColumnView["tone"][] = ["acc", "ink", "soft"]

function field(value: string): string {
  if (/[|;\n]/.test(value)) throw new Error(`Unsafe wire text: ${value}`)
  return value
}

const records = (rows: readonly (readonly (string | number)[])[]): string =>
  rows.map((row) => row.map((each) => field(String(each))).join("|")).join(";")

const stats = (list: readonly RewardStat[]) =>
  records(
    list.map((stat) =>
      stat.note === undefined
        ? [stat.label, stat.value]
        : [stat.label, stat.value, stat.note],
    ),
  )

function panelLines(panel: LockPanelView): string[] {
  return [
    records([[panel.figure, panel.note]]),
    stats(panel.stats),
    records(
      panel.columns.map((column) => [
        column.label,
        column.value,
        column.text,
        column.count,
        tones.indexOf(column.tone),
        column.short,
      ]),
    ),
  ]
}

export function lockWireOut(view: LockDistributionView): LockDistributionWire {
  const shares = (parts: LockDistributionView["permanence"]["amount"]) =>
    records(parts.map((part) => [part.label, part.value, part.bps]))
  return [
    field(view.asOf),
    ...panelLines(view.length),
    ...panelLines(view.size),
    ...panelLines(view.calendar),
    field(view.permanence.figure),
    stats(view.permanence.stats),
    shares(view.permanence.amount),
    shares(view.permanence.power),
    view.stale ? "1" : "",
  ].join("\n")
}

const rows = (line: string | undefined): string[][] =>
  line === undefined || line === ""
    ? []
    : line.split(";").map((row) => row.split("|"))

const statsIn = (line: string | undefined): RewardStat[] =>
  rows(line).map(([label = "", value = "", note]) =>
    note === undefined ? { label, value } : { label, value, note },
  )

function panelIn(lines: readonly (string | undefined)[]): LockPanelView {
  const [head, list, columns] = lines
  const [figure = "", note = ""] = rows(head)[0] ?? []
  return {
    figure,
    note,
    stats: statsIn(list),
    columns: rows(columns).map(
      ([
        label = "",
        value = "0",
        text = "",
        count = "0",
        tone = "0",
        short,
      ]) => ({
        label,
        value: Number(value),
        text,
        short: short ?? text,
        count: Number(count),
        tone: tones[Number(tone)] ?? "acc",
      }),
    ),
  }
}

export function lockWireIn(
  wire: LockDistributionWire,
  escrow: VoterEscrow,
): LockDistributionView {
  const lines = wire.split("\n")
  const shares = (line: string | undefined) =>
    rows(line).map(([label = "", value = "", bps = "0"]) => ({
      label,
      value,
      bps: Number(bps),
    }))
  return {
    escrow,
    asOf: lines[0] ?? "",
    stale: lines[14] === "1",
    length: panelIn(lines.slice(1, 4)),
    size: panelIn(lines.slice(4, 7)),
    calendar: panelIn(lines.slice(7, 10)),
    permanence: {
      figure: lines[10] ?? "",
      note: "permanent",
      stats: statsIn(lines[11]),
      amount: shares(lines[12]),
      power: shares(lines[13]),
    },
  }
}

// -- one-figure epoch panels (APR, APY history, emissions) -------------------

/** A one-figure epoch panel as the page sends it: one string, as above. */
export type FigureWire = string

export type FigureView = {
  figure: string
  note: string
  stats: RewardStat[]
  bars: { epoch: number; value: number; text: string; current: boolean }[]
}

export function figureWireOut(view: FigureView): FigureWire {
  return [
    field(view.figure),
    field(view.note),
    stats(view.stats),
    records(
      view.bars.map((bar) => [
        bar.epoch,
        bar.value,
        bar.text,
        bar.current ? 1 : 0,
      ]),
    ),
  ].join("\n")
}

export function figureWireIn(wire: FigureWire): FigureView {
  const [figure = "", note = "", list, bars] = wire.split("\n")
  return {
    figure,
    note,
    stats: statsIn(list),
    bars: rows(bars).map(([epoch = "0", value = "0", text = "", current]) => ({
      epoch: Number(epoch),
      value: Number(value),
      text,
      current: current === "1",
    })),
  }
}
