/**
 * The boost calculator opens over any page from the URL:
 * `?calc=1&vebtc=1&vemezo=100000&for=5&solve=vemezo` (a bare `?calc` works
 * too). Links from Matchscan, the homepage and Stuart use it, always in the
 * same tab, and Back closes the sheet. The root route keeps these keys in
 * its search (see `lib/viewer`).
 *
 * `solve` says which figure the calculator works out: `vemezo` (the veMEZO
 * a lock needs for the boost in `for`), `vebtc` (the veBTC that veMEZO
 * takes to it) or `boost` (from both figures). Without it, a link with
 * both figures works out the boost, as links did before `solve` existed,
 * and any other works out the veMEZO.
 */

/** Which figure the calculator works out. */
export type CalcSolve = "vemezo" | "vebtc" | "boost"

export type CalcSearch = {
  /** Present when the calculator is open. */
  calc?: 1 | undefined
  /**
   * veBTC voting power, a plain decimal. A number when the router read one
   * from the URL: kept as it came, so `?vebtc=1` stays `?vebtc=1` and is
   * not rewritten as a quoted string with a redirect.
   */
  vebtc?: string | number | undefined
  /** veMEZO votes on its gauge, a plain decimal. */
  vemezo?: string | number | undefined
  /** The boost to aim for, 1 to 5 with up to two places: `5`, `3.25`. */
  for?: string | number | undefined
  /** Which figure to work out, see above. */
  solve?: string | undefined
}

const decimal = /^\d{1,12}(\.\d{1,18})?$/
const boost = /^([1-5])(?:\.(\d{1,2}))?$/

function amount(value: unknown): string | undefined {
  const text =
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? String(value)
      : typeof value === "string"
        ? value.trim().replaceAll(",", "")
        : ""
  return decimal.test(text) ? text : undefined
}

/** A boost of 1 to 5 as hundredths, 100 to 500: "3.25" is 325. */
function target(value: unknown): number | undefined {
  const match =
    typeof value === "string" || typeof value === "number"
      ? boost.exec(String(value).trim())
      : null
  if (match === null) return undefined
  const hundredths =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
  return hundredths <= 500 ? hundredths : undefined
}

function solveOf(value: unknown): CalcSolve | undefined {
  return value === "vemezo" || value === "vebtc" || value === "boost"
    ? value
    : undefined
}

/** 325 as "3.25", 500 as "5"; undefined unless 100 to 500. */
function boostText(hundredths: number): string | undefined {
  if (!Number.isInteger(hundredths) || hundredths < 100 || hundredths > 500) {
    return undefined
  }
  const fraction = `${hundredths % 100}`.padStart(2, "0").replace(/0+$/, "")
  const whole = Math.floor(hundredths / 100)
  return fraction === "" ? `${whole}` : `${whole}.${fraction}`
}

/** A plain decimal as the URL carries it best: a number when it is one. */
function plain(text: string | undefined): string | number | undefined {
  if (text === undefined) return undefined
  return String(Number(text)) === text ? Number(text) : text
}

/** What the sheet starts from: the link's keys, checked. */
export type CalcFill = {
  vebtc?: string
  vemezo?: string
  /** The boost to aim for in hundredths, 100 to 500. */
  target?: number
  solve?: CalcSolve
}

/** The calculator's keys from a route search, dropping anything malformed. */
export function calcSearchFrom(
  search: Record<string, unknown>,
): CalcFill & { calc?: 1 } {
  if (!("calc" in search) || search.calc === false || search.calc === "0") {
    return {}
  }
  const vebtc = amount(search.vebtc)
  const vemezo = amount(search.vemezo)
  const aim = target(search.for)
  const solve = solveOf(search.solve)
  return {
    calc: 1,
    ...(vebtc === undefined ? {} : { vebtc }),
    ...(vemezo === undefined ? {} : { vemezo }),
    ...(aim === undefined ? {} : { target: aim }),
    ...(solve === undefined ? {} : { solve }),
  }
}

/**
 * What a link asked the calculator to start with, checked: anything that
 * is not a plain amount, a boost or a figure to solve for is dropped. The
 * root route passes the keys through unchecked (`lib/viewer`), so this
 * runs when the sheet opens.
 */
export function calcFill(search: CalcSearch): CalcFill {
  const { calc: _calc, ...fill } = calcSearchFrom({ ...search })
  return fill
}

/** The search that opens the calculator, filled with what is known. */
export function calcSearch(fill: {
  veBtc?: string | null
  veMezo?: string | null
  /** The boost to aim for in hundredths, 100 to 500. */
  target?: number
  solve?: CalcSolve
}): CalcSearch {
  const vebtc = plain(amount(fill.veBtc ?? undefined))
  const vemezo = plain(amount(fill.veMezo ?? undefined))
  const aim = plain(
    fill.target === undefined ? undefined : boostText(fill.target),
  )
  return {
    calc: 1,
    ...(vebtc === undefined ? {} : { vebtc }),
    ...(vemezo === undefined ? {} : { vemezo }),
    ...(aim === undefined ? {} : { for: aim }),
    ...(fill.solve === undefined ? {} : { solve: fill.solve }),
  }
}

/** A search without the calculator's keys: what closing it leaves. */
export function withoutCalc<T extends CalcSearch>(
  search: T,
): Omit<T, keyof CalcSearch> {
  const {
    calc: _calc,
    vebtc: _vebtc,
    vemezo: _vemezo,
    for: _for,
    solve: _solve,
    ...rest
  } = search
  return rest
}
