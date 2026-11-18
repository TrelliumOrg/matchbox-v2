import type { ReactNode } from "react"

const days = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]

/** The week as a bar from Thursday 00:00 UTC, filled to now. */
export function WeekProgress({ progress }: { progress: number }): ReactNode {
  return (
    <figure className="mt-6">
      <p
        role="img"
        aria-label={`${Math.floor(progress / 100)}% of the week gone`}
        className="relative h-2.5 overflow-hidden rounded-full bg-soft2"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-acc"
          style={{ width: `${progress / 100}%` }}
        />
      </p>
      <figcaption
        aria-hidden="true"
        className="mt-2 grid grid-cols-7 text-[14px] text-sec"
      >
        {days.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </figcaption>
    </figure>
  )
}
