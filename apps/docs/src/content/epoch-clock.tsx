import {
  EPOCH_SECONDS,
  epochIndexFor,
  epochStartOf,
  VOTE_WINDOW_PADDING_SECONDS,
} from "@matchbox/domain/epoch"
import { type ReactNode, useEffect, useState } from "react"

/**
 * The live figure on the Epochs page (Doop `PJeK7-fyu0`): this epoch's
 * number and dates, the time to the next one and where the week stands.
 * Computed in the browser from @matchbox/domain's clock: no request, no
 * live feed. The prerendered HTML holds the frame at its final size with
 * placeholders, so filling it in moves nothing: the countdown and the time
 * keep a minimum width as wide as their longest value, and the time comes
 * last in its row. A smoke test fails on any layout shift.
 */

const days = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
})

function date(seconds: number): string {
  return dateFormat.format(new Date(seconds * 1000)).replace(",", "")
}

export function countdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const d = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3_600)
  const m = Math.floor((total % 3_600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export type ClockState = {
  epoch: number
  start: number
  end: number
  now: number
}

export function clockAt(nowSeconds: number): ClockState {
  const start = epochStartOf(nowSeconds)
  return {
    epoch: epochIndexFor(start),
    start,
    end: start + EPOCH_SECONDS,
    now: nowSeconds,
  }
}

function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function EpochClock(): ReactNode {
  const now = useNow()
  const state = now === null ? null : clockAt(now)
  const progress =
    state === null ? 0 : (state.now - state.start) / (state.end - state.start)
  const today =
    state === null ? -1 : Math.floor((state.now - state.start) / 86_400)
  return (
    <figure className="mt-[26px]">
      <div className="rounded-[24px] bg-soft px-[22px] pt-5 pb-[18px]">
        <p className="text-[15px] text-sec">
          <span className="font-semibold text-ink">
            {state === null ? "This epoch" : `Epoch ${state.epoch}`}
          </span>
          {state === null
            ? null
            : `, ${date(state.start)} to ${date(state.end)}`}
        </p>
        <p className="mt-1 flex items-baseline gap-2.5" aria-live="off">
          <span className="min-w-[6.5ch] text-[44px] leading-[52px] font-[650] tracking-[-0.02em] text-ink tabular-nums max-sm:text-[36px]">
            {state === null ? "0d 0h" : countdown(state.end - state.now)}
          </span>
          <span className="text-[15px] text-sec">
            {state === null
              ? "until the next epoch"
              : `until Epoch ${state.epoch + 1}`}
          </span>
        </p>
        <div className="mt-4" aria-hidden="true">
          <div className="relative h-2 rounded-full bg-soft2">
            <div
              className="absolute inset-y-0 left-0 origin-left rounded-full bg-acc"
              style={{ width: "100%", transform: `scaleX(${progress})` }}
            />
          </div>
          <ol className="mt-2 grid grid-cols-7 text-[13px] text-sec">
            {days.map((day, index) => (
              <li
                key={day}
                className={index === today ? "font-semibold text-ink" : ""}
              >
                {day}
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-[14px] text-sec">
          <span>
            Votes revert{" "}
            <span className="font-semibold text-ink">
              Thu 00:00 to{" "}
              {String(VOTE_WINDOW_PADDING_SECONDS / 3600).padStart(2, "0")}:00
            </span>
          </span>
          <span>
            Now{" "}
            <span className="inline-block min-w-[21ch] font-semibold text-ink tabular-nums">
              {state === null
                ? "00:00 UTC"
                : `${date(state.now)} ${timeFormat.format(new Date(state.now * 1000))} UTC`}
            </span>
          </span>
        </p>
      </div>
      <figcaption className="mt-2.5 text-[14px] leading-5 text-sec">
        Computed in your browser from Epoch 0. No request and no live feed.
      </figcaption>
    </figure>
  )
}
