import {
  BOOST_WAD,
  type BoostTotals,
  boostWadFromHundredths,
  formatBoostWad,
  hundredthsFromBoostWad,
  MAX_BOOST_WAD,
} from "@matchbox/domain"
import { TokenIcon } from "@matchbox/token-icons"
import * as Field from "@matchbox/ui/field"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as Sheet from "@matchbox/ui/sheet"
import * as Slider from "@matchbox/ui/slider"
import { type ReactNode, useEffect, useId, useState } from "react"
import { useLoad } from "../account/panel-parts"
import { fetchLive } from "../data/live-query"
import { overviewQuery } from "../data/queries"
import type { Lock, LockKind } from "../data/view-models"
import {
  formatCompact,
  formatDay,
  formatTime,
  formatVoteAmount,
  groupThousands,
} from "../lib/format"
import { useViewer } from "../lib/viewer"
import { useLive } from "../live/live-context"
import { readRpc, useSettings } from "../settings/settings-store"
import { openTx } from "../tx/tx-store"
import { openWallet, walletIntent } from "../wallet/wallet-store"
import { type CalcSearch, type CalcSolve, calcFill } from "./calc-link"
import {
  type CalcModel,
  calcModel,
  fieldValue,
  solvedText,
  typedTotals,
  usableLocks,
  wholeUp,
} from "./calc-model"
import { useBoostTotals } from "./use-totals"

/**
 * The boost calculator (Doop `FETBd5bLpx`): a right sheet over any page,
 * which works like Matchbox Classic's. Both figures sit together, veBTC
 * voting power and the veMEZO votes on its gauge, each with a Calculate
 * toggle, over a 1× to 5× boost slider. The toggled field is worked out:
 *
 *   veMEZO   type veBTC, choose a boost: the veMEZO it needs
 *   veBTC    type veMEZO, choose a boost: the veBTC it takes there
 *   neither  type both: the boost, which the slider shows; moving the
 *            slider then works out the veMEZO for the boost chosen
 *
 * The toggle is not a padlock: in Matchbox a lock is a token lock, and
 * "Use your locks" sits right under each field.
 *
 * It opens on 1 veBTC, which is 1 BTC locked for 4 weeks, working out the
 * veMEZO for 5×; when the wallet has a veMEZO lock it fills that in and
 * works out the boost instead. The system totals come from the chain
 * (`./totals`), are read again every minute while the sheet is open, and
 * can be typed over ("Try other totals"). When they cannot be read the
 * sheet says so: it shows the last totals of this visit by block, or no
 * result at all. It never shows a made-up number.
 */

const scanBlock = (block: number): string =>
  `https://scan.matchbox.markets/block/${block}`

const whole = (wei: bigint): number => Number(wei / 10n ** 18n)

/** "654.52 veBTC", "99.39M veMEZO": a system total. */
function totalLabel(wei: bigint, unit: "veBTC" | "veMEZO"): string {
  if (unit === "veMEZO") return `${formatCompact(wei / 10n ** 18n)} veMEZO`
  const cents = (wei * 100n) / 10n ** 18n
  return `${groupThousands(cents / 100n)}.${(cents % 100n).toString().padStart(2, "0")} veBTC`
}

/** "Thu 12 Nov, 06:14 UTC" */
function readLabel(unix: number): string {
  return `${formatDay(unix)}, ${formatTime(unix)} UTC`
}

const unitOf: Record<LockKind, "veBTC" | "veMEZO"> = {
  vebtc: "veBTC",
  vemezo: "veMEZO",
}

/** "3.25×" */
const times = (wad: bigint): string => `${formatBoostWad(wad)}×`

const marks = [1, 2, 3, 4, 5].map((each) => ({
  value: each * 100,
  label: `${each}×`,
}))

/** The line under a field: the wallet's lock to fill it from, or a hint. */
function FieldFoot({
  kind,
  locks,
  connected,
  own,
  hint,
  onUse,
}: {
  kind: LockKind
  locks: readonly Lock[]
  connected: boolean
  /** The connected wallet's locks, not a wallet being viewed. */
  own: boolean
  hint: string
  onUse: (lock: Lock) => void
}): ReactNode {
  const [choosing, setChoosing] = useState(false)
  const [first] = locks
  const link =
    "cursor-pointer rounded-sm font-semibold text-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ink"
  if (first === undefined) {
    return (
      <p className="mt-2 flex items-center justify-between gap-3 px-1 text-[14.5px] text-sec">
        <span>{connected ? hint : "Use your locks"}</span>
        {connected ? null : (
          <button
            type="button"
            {...walletIntent}
            onClick={openWallet}
            className={link}
          >
            Connect wallet
          </button>
        )}
      </p>
    )
  }
  const label = (lock: Lock): string =>
    `#${lock.tokenId}, ${formatVoteAmount(lock.votingPowerWei, unitOf[kind])}`
  return (
    <div className="mt-2 px-1 text-[14.5px] text-sec">
      <p className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate">
          {locks.length === 1
            ? `${own ? "Your" : "This wallet's"} lock ${label(first)}`
            : `${own ? "Your" : "This wallet's"} ${locks.length} ${unitOf[kind]} locks`}
        </span>
        <button
          type="button"
          aria-expanded={locks.length > 1 ? choosing : undefined}
          onClick={() =>
            locks.length === 1 ? onUse(first) : setChoosing((now) => !now)
          }
          className={link}
        >
          Use
        </button>
      </p>
      {choosing ? (
        <ul className="mt-2 flex max-h-[176px] flex-col gap-1 overflow-y-auto rounded-[16px] bg-soft p-1.5">
          {locks.map((lock) => (
            <li key={lock.tokenId}>
              <button
                type="button"
                onClick={() => {
                  onUse(lock)
                  setChoosing(false)
                }}
                className="flex h-10 w-full cursor-pointer items-center rounded-[12px] px-3 text-left text-[14.5px] text-ink tabular-nums outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
              >
                {label(lock)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Which field is worked out: "Calculate" on each, pressed (ink, with a
 * check) on the one being calculated. Pressing it on the other field
 * calculates that one; pressing it again calculates the boost.
 */
function CalcToggle({
  unit,
  pressed,
  onToggle,
}: {
  unit: "veBTC" | "veMEZO"
  pressed: boolean
  onToggle: () => void
}): ReactNode {
  return (
    <button
      type="button"
      data-tap=""
      data-calc-toggle=""
      aria-pressed={pressed}
      title={
        pressed
          ? `${unit} is calculated. Press to calculate the boost instead`
          : `Calculate ${unit} from the other figure and the boost`
      }
      onClick={onToggle}
      className={`flex h-8 flex-none cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${pressed ? "bg-ink text-bg" : "bg-soft text-ink hover:bg-soft2 dark:bg-soft2"}`}
    >
      <Glyph
        shape={pressed ? shapes.check : shapes.calculator}
        size={15}
        strokeWidth={2.2}
      />
      Calculate<span className="sr-only"> {unit}</span>
    </button>
  )
}

function AmountBox({
  label,
  ticker,
  unit,
  value,
  onValueChange,
  decimals,
  placeholder,
  solved = false,
  toggle,
}: {
  label: string
  ticker: "BTC" | "MEZO"
  unit: "veBTC" | "veMEZO"
  value: string
  onValueChange: (value: string) => void
  decimals: number
  placeholder: string
  /** Worked out, not typed: read-only on a soft ground. */
  solved?: boolean
  /** The Calculate toggle, on the label's line. */
  toggle?: ReactNode
}): ReactNode {
  const pill = (
    <span
      className={`ml-auto flex h-[46px] flex-none items-center gap-[9px] rounded-[23px] pr-4 pl-[7px] text-base font-[650] ${solved ? "bg-raised dark:bg-soft" : "bg-soft"}`}
    >
      <TokenIcon ticker={ticker} size={32} />
      {unit}
    </span>
  )
  const input = (
    <Field.Input
      value={value}
      onValueChange={onValueChange}
      decimals={decimals}
      placeholder={placeholder}
      readOnly={solved}
      className={`${toggle === undefined ? "" : "mt-0 min-w-0 flex-1 max-sm:text-[28px]"} ${solved ? "text-ink2" : ""}`}
    />
  )
  if (toggle === undefined) {
    return (
      <Field.Root>
        <Field.Box>
          <div className="min-w-0 flex-1">
            <Field.Label>{label}</Field.Label>
            {input}
          </div>
          {pill}
        </Field.Box>
      </Field.Root>
    )
  }
  return (
    <Field.Root>
      <Field.Box
        data-solved={solved ? "" : undefined}
        className={`flex-col items-stretch gap-1 pt-3 max-sm:pr-3 max-sm:pl-4 ${solved ? "border-transparent bg-soft dark:bg-soft2" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Field.Label className="truncate">{label}</Field.Label>
          {toggle}
        </div>
        <div className="flex items-center gap-3">
          {input}
          {pill}
        </div>
      </Field.Box>
    </Field.Root>
  )
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sec">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

const waiting = "…"

/** The one line on what is worked out. */
function solving(solve: CalcSolve, target: bigint): string {
  if (solve === "vemezo") {
    return `Calculating the veMEZO needed for ${times(target)}`
  }
  if (solve === "vebtc") {
    return `Calculating the veBTC this veMEZO takes to ${times(target)}`
  }
  return "Calculating the boost from the veBTC and veMEZO entered"
}

/** What to know about the answer, or why there is none. */
function notes(model: CalcModel, target: bigint, loading: boolean): string[] {
  switch (model.missing) {
    case "vebtc":
      return [
        model.solve === "boost"
          ? "Enter veBTC to work out the boost."
          : "Enter veBTC to work out the veMEZO it needs.",
      ]
    case "vemezo":
      return ["Enter veMEZO to work out the veBTC it takes."]
    case "no-vemezo":
      return [
        `No amount of veBTC reaches ${times(target)} without veMEZO: every veBTC lock stays at 1×.`,
      ]
    case "at-one":
      return [
        "No amount of veBTC lands on exactly 1×: any veMEZO lifts a veBTC lock above it. Choose a higher boost.",
      ]
    case "totals":
      return loading ? [] : ["Needs the system totals, below."]
    default:
      break
  }
  const lines: string[] = []
  if (model.solve === "vemezo" && target <= BOOST_WAD) {
    lines.push("At 1× no veMEZO is needed.")
  }
  if (model.over !== null) {
    lines.push(
      `5× is the most a veBTC lock gets. The last ${formatVoteAmount(model.over, "veMEZO")} adds nothing.`,
    )
  }
  if (model.solve === "boost") {
    lines.push("Choose a boost on the slider to calculate the veMEZO it needs.")
  }
  return lines
}

export type BoostCalculatorProps = {
  open: boolean
  onClose: () => void
  /** What the link that opened it carried. */
  fill: CalcSearch
}

export default function BoostCalculator({
  open,
  onClose,
  fill: asked,
}: BoostCalculatorProps): ReactNode {
  // Checked once: a link's keys reach here as typed.
  const [fill] = useState(() => calcFill(asked))
  const viewer = useViewer()
  const { rpc } = useLive()
  useSettings()
  const totals = useBoostTotals(open, readRpc(rpc))
  const address = viewer.kind === "signed-out" ? null : viewer.address
  const overview = useLoad(`calc-locks-${address ?? "none"}`, async () =>
    address === null ? null : fetchLive(overviewQuery(address)),
  )
  const locks = overview.data?.locks ?? []
  const veBtcLocks = usableLocks(locks, "vebtc")
  const veMezoLocks = usableLocks(locks, "vemezo")

  // 1 veBTC is 1 BTC locked for 4 weeks, and the commonest question is
  // how much veMEZO it needs for 5×. A link with both figures asks for
  // the boost.
  const [veBtc, setVeBtc] = useState(fill.vebtc ?? "1")
  const [veMezo, setVeMezo] = useState(fill.vemezo ?? "")
  const [solve, setSolve] = useState<CalcSolve>(
    fill.solve ?? (fill.vemezo === undefined ? "vemezo" : "boost"),
  )
  const [target, setTarget] = useState(() =>
    boostWadFromHundredths(fill.target ?? 500),
  )
  const [touched, setTouched] = useState({
    veBtc: fill.vebtc !== undefined,
    veMezo: fill.vemezo !== undefined,
    solve: fill.solve !== undefined || fill.target !== undefined,
  })
  // The wallet's own locks fill fields nobody typed in or linked to; its
  // veMEZO lock turns the question into the boost that lock gets.
  const firstVeBtc = veBtcLocks[0]?.votingPowerWei ?? null
  const firstVeMezo = veMezoLocks[0]?.votingPowerWei ?? null
  useEffect(() => {
    if (firstVeBtc !== null && !touched.veBtc) {
      setVeBtc(fieldValue(BigInt(firstVeBtc), 4))
    }
    if (firstVeMezo !== null && !touched.veMezo) {
      setVeMezo(fieldValue(BigInt(firstVeMezo), 0))
      if (!touched.solve) setSolve("boost")
    }
  }, [firstVeBtc, firstVeMezo, touched.veBtc, touched.veMezo, touched.solve])

  const [totalsOpen, setTotalsOpen] = useState(false)
  const [custom, setCustom] = useState<{
    veBtc: string
    veMezo: string
  } | null>(null)
  // Never read at all: the totals open for typing, results wait.
  const unread = totals.read === null && totals.failed
  const editing = custom !== null || unread
  const typed = editing
    ? typedTotals(custom?.veBtc ?? "", custom?.veMezo ?? "")
    : null
  const effective: BoostTotals | null = editing ? typed : totals.read
  const model = calcModel({ solve, veBtc, veMezo, target, totals: effective })
  const loading = effective === null && !editing

  const totalsId = useId()
  const boostId = useId()
  const veMezoLabel = (wei: bigint): string => formatVoteAmount(wei, "veMEZO")
  /** A veMEZO figure that is needed: rounded up, so it is enough. */
  const neededLabel = (wei: bigint): string => veMezoLabel(wholeUp(wei))
  const shown = model.boost ?? target
  const atMax = model.boost !== null && model.boost >= MAX_BOOST_WAD
  const lines = notes(model, target, loading)
  const typedMezo = model.veMezo ?? 0n

  // Said once when what is calculated changes (not on every slider step).
  const [announced, setAnnounced] = useState("")

  /** Calculates `field`, or the boost when `field` already is. */
  const toggle = (field: "vebtc" | "vemezo"): void => {
    // The worked-out figure stays as it reads, now typed.
    const text = solvedText(model)
    if (solve === "vemezo") setVeMezo(text)
    if (solve === "vebtc") setVeBtc(text)
    // From the boost: aim for the one there is (1× is no aim).
    const aimed =
      solve === "boost" && model.boost !== null && model.boost > BOOST_WAD
        ? model.boost
        : target
    setTarget(aimed)
    const next = solve === field ? "boost" : field
    setSolve(next)
    setAnnounced(solving(next, aimed))
    setTouched({ veBtc: true, veMezo: true, solve: true })
  }

  /**
   * A boost chosen on the slider or a mark. While the boost is what is
   * calculated, choosing one calculates the veMEZO for it instead, with
   * the veBTC kept: as if veMEZO's Calculate had been pressed first.
   */
  const aim = (hundredths: number): void => {
    const next = boostWadFromHundredths(hundredths)
    setTarget(next)
    if (solve === "boost") {
      setSolve("vemezo")
      setAnnounced(solving("vemezo", next))
    }
    setTouched({ veBtc: true, veMezo: true, solve: true })
  }

  /** A wallet lock into `field`: a figure typed, so not one worked out. */
  const use = (field: "vebtc" | "vemezo", lock: Lock): void => {
    if (field === "vebtc") setVeBtc(fieldValue(BigInt(lock.votingPowerWei), 4))
    else setVeMezo(fieldValue(BigInt(lock.votingPowerWei), 0))
    if (solve === field) setSolve("boost")
    setTouched({ veBtc: true, veMezo: true, solve: true })
  }

  let figure: { text: string; small: boolean }
  if (model.solve !== "boost") {
    figure = { text: times(target), small: false }
  } else if (model.boost !== null) {
    figure = { text: times(model.boost), small: false }
  } else if (model.missing === "totals") {
    figure = {
      text: loading ? waiting : "Needs the system totals",
      small: !loading,
    }
  } else {
    figure = { text: "Enter veBTC", small: true }
  }

  return (
    <Sheet.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Sheet.Content data-boost-calculator="">
        <Sheet.Header>Boost calculator</Sheet.Header>
        <Sheet.Body>
          {totals.failed ? (
            <div
              role="status"
              className="mb-4 flex items-start gap-3 rounded-[18px] bg-acc-soft px-4 py-3.5 text-[14.5px] text-acc-ink"
            >
              <Glyph shape={shapes.triangleAlert} size={18} strokeWidth={1.8} />
              <p>
                {totals.read === null
                  ? "System totals could not be read"
                  : `Totals from block ${groupThousands(BigInt(totals.read.block))}, ${formatTime(totals.read.readAt)} UTC`}
                <button
                  type="button"
                  onClick={totals.retry}
                  className="mt-0.5 block cursor-pointer rounded-sm font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-current"
                >
                  Try again
                </button>
              </p>
            </div>
          ) : null}

          <p role="status" className="sr-only" data-calc-announce="">
            {announced}
          </p>
          <p
            data-calc-solving=""
            className="mb-3 flex items-start gap-2 px-1 text-[15px] font-semibold text-ink2"
          >
            <Glyph
              shape={shapes.calculator}
              size={17}
              strokeWidth={1.9}
              className="mt-[2px] flex-none"
            />
            {solving(solve, target)}
          </p>

          <AmountBox
            label="veBTC voting power"
            ticker="BTC"
            unit="veBTC"
            value={solve === "vebtc" ? solvedText(model) : veBtc}
            onValueChange={(value) => {
              setVeBtc(value)
              setTouched((now) => ({ ...now, veBtc: true }))
            }}
            decimals={8}
            placeholder="0.0000"
            solved={solve === "vebtc"}
            toggle={
              <CalcToggle
                unit="veBTC"
                pressed={solve === "vebtc"}
                onToggle={() => toggle("vebtc")}
              />
            }
          />
          <FieldFoot
            kind="vebtc"
            locks={veBtcLocks}
            connected={address !== null}
            own={viewer.kind === "connected"}
            hint="1 veBTC is 1 BTC locked for 4 weeks"
            onUse={(lock) => use("vebtc", lock)}
          />
          <div className="mt-4">
            <AmountBox
              label="veMEZO on its gauge"
              ticker="MEZO"
              unit="veMEZO"
              value={solve === "vemezo" ? solvedText(model) : veMezo}
              onValueChange={(value) => {
                setVeMezo(value)
                setTouched((now) => ({ ...now, veMezo: true }))
              }}
              decimals={0}
              placeholder="0"
              solved={solve === "vemezo"}
              toggle={
                <CalcToggle
                  unit="veMEZO"
                  pressed={solve === "vemezo"}
                  onToggle={() => toggle("vemezo")}
                />
              }
            />
            <FieldFoot
              kind="vemezo"
              locks={veMezoLocks}
              connected={address !== null}
              own={viewer.kind === "connected"}
              hint="The veMEZO voting for the lock's gauge"
              onUse={(lock) => use("vemezo", lock)}
            />
          </div>

          <section
            aria-label="Boost"
            className="mt-5 overflow-hidden rounded-[20px] bg-soft"
          >
            <div className="px-5 pt-[18px] pb-4">
              <div className="flex items-baseline justify-between gap-4">
                <p id={boostId} className="text-[15px] text-sec">
                  {solve === "boost" ? "Boost" : "Boost to aim for"}
                </p>
                <p
                  data-boost-figure=""
                  aria-live={solve === "boost" ? "polite" : "off"}
                  className={
                    figure.small
                      ? "text-right text-[17px] font-semibold text-sec"
                      : `text-[44px] leading-none font-[650] tracking-[-0.025em] tabular-nums max-sm:text-[38px] ${atMax ? "text-pos" : ""}`
                  }
                >
                  {figure.text}
                </p>
              </div>
              <Slider.Root
                className="mt-3"
                aria-labelledby={boostId}
                min={100}
                max={500}
                value={hundredthsFromBoostWad(shown)}
                valueText={times(shown)}
                marks={marks}
                markLabel={(mark) => `Aim for ${mark.label}`}
                onValueChange={aim}
              />
              <div aria-live="polite" data-calc-notes="">
                {lines.map((line) => (
                  <p key={line} className="mt-2 text-[14.5px] text-sec">
                    {line}
                  </p>
                ))}
              </div>
            </div>
            {solve === "boost" &&
            model.forMax !== null &&
            model.veBtc !== null ? (
              <GaugeCard.Band
                votes={whole(typedMezo)}
                optimal={whole(wholeUp(model.forMax))}
                count={groupThousands(typedMezo / 10n ** 18n)}
                of={`of ${neededLabel(model.forMax)}`}
                toGo={
                  model.forMax > typedMezo
                    ? `${neededLabel(model.forMax - typedMezo)} to go`
                    : "At 5×"
                }
                over={`${veMezoLabel(model.over ?? 0n)} over`}
              />
            ) : null}
          </section>

          <dl className="mt-4 flex flex-col gap-3 px-1 text-[15px]">
            <Row
              label={`veMEZO per veBTC for ${times(shown)}`}
              value={
                model.ratio === null
                  ? loading
                    ? waiting
                    : "Needs the system totals"
                  : neededLabel(model.ratio)
              }
            />
            {model.forMax === null ||
            model.veBtc === null ||
            solve === "boost" ||
            shown === MAX_BOOST_WAD ? null : (
              <Row
                label={`veMEZO for 5× at ${formatVoteAmount(model.veBtc, "veBTC")}`}
                value={neededLabel(model.forMax)}
              />
            )}
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                aria-expanded={totalsOpen || editing}
                aria-controls={totalsId}
                onClick={() => setTotalsOpen((now) => !now)}
                className="flex cursor-pointer items-center gap-2 rounded-sm text-base font-[650] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ink"
              >
                System totals
                <span
                  className={`flex transition-transform duration-200 ${totalsOpen || editing ? "rotate-180" : ""}`}
                >
                  <Glyph shape={shapes.chevronDown} size={16} strokeWidth={2} />
                </span>
              </button>
              {custom !== null ? (
                <span className="rounded-full bg-soft px-2.5 py-0.5 text-[13px] font-semibold text-ink2">
                  Edited
                </span>
              ) : totals.read === null ? null : (
                <a
                  href={scanBlock(totals.read.block)}
                  className="rounded-sm font-mono text-[13px] text-sec underline-offset-[3px] outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                >
                  Block {groupThousands(BigInt(totals.read.block))}
                </a>
              )}
            </div>
            <div id={totalsId} hidden={!(totalsOpen || editing)}>
              {editing ? (
                <div className="mt-3 flex flex-col gap-3">
                  <AmountBox
                    label="veBTC voting power, all locks"
                    ticker="BTC"
                    unit="veBTC"
                    value={custom?.veBtc ?? ""}
                    onValueChange={(value) =>
                      setCustom((now) => ({
                        veBtc: value,
                        veMezo: now?.veMezo ?? "",
                      }))
                    }
                    decimals={4}
                    placeholder="0.00"
                  />
                  <AmountBox
                    label="veMEZO voting power, all locks"
                    ticker="MEZO"
                    unit="veMEZO"
                    value={custom?.veMezo ?? ""}
                    onValueChange={(value) =>
                      setCustom((now) => ({
                        veBtc: now?.veBtc ?? "",
                        veMezo: value,
                      }))
                    }
                    decimals={0}
                    placeholder="0"
                  />
                  {totals.read === null ? null : (
                    <p>
                      <button
                        type="button"
                        onClick={() => setCustom(null)}
                        className="cursor-pointer rounded-sm text-[14.5px] font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
                      >
                        Use live totals
                      </button>
                    </p>
                  )}
                </div>
              ) : totals.read === null ? (
                <p className="mt-3 text-[15px] text-sec">Reading</p>
              ) : (
                <>
                  <dl className="mt-3 flex flex-col gap-3 text-[15px]">
                    <Row
                      label="veBTC voting power, all locks"
                      value={totalLabel(totals.read.veBtc, "veBTC")}
                    />
                    <Row
                      label="veMEZO voting power, all locks"
                      value={totalLabel(totals.read.veMezo, "veMEZO")}
                    />
                    <Row label="Read" value={readLabel(totals.read.readAt)} />
                  </dl>
                  <p className="mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const read = totals.read
                        if (read === null) return
                        setCustom({
                          veBtc: fieldValue(read.veBtc, 2),
                          veMezo: fieldValue(read.veMezo, 0),
                        })
                      }}
                      className="cursor-pointer rounded-sm text-[14.5px] font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
                    >
                      Try other totals
                    </button>
                  </p>
                </>
              )}
            </div>
          </div>
        </Sheet.Body>
        <Sheet.Footer>
          {viewer.kind === "connected" ? (
            <PillButton.Root
              size="lg"
              onClick={() => {
                onClose()
                openTx(viewer, { flow: "new-lock", kind: "vebtc" })
              }}
            >
              New lock
            </PillButton.Root>
          ) : (
            <PillButton.Root size="lg" {...walletIntent} onClick={openWallet}>
              Connect wallet
            </PillButton.Root>
          )}
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  )
}
