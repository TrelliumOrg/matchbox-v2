import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { HomeSearch } from "../search/search-bar"

/**
 * Not found (`vF29nhdD8n`): the search field, a card saying what was not
 * found, and the places to try instead.
 */

type Instead = {
  to: "/network/transactions" | "/gauges" | "/epochs"
  title: string
  detail: string
  icon: GlyphShape
}

const instead: readonly Instead[] = [
  {
    to: "/network/transactions",
    title: "Latest transactions",
    detail: "Network",
    icon: shapes.list,
  },
  {
    to: "/gauges",
    title: "Gauges",
    detail: "This epoch",
    icon: shapes.squareCheck,
  },
  {
    to: "/epochs",
    title: "Epochs",
    detail: "Every epoch",
    icon: shapes.calendarDays,
  },
]

export function NotFoundPage(): ReactNode {
  return (
    <div className="mt-10 max-xl:mt-6">
      <HomeSearch />
      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,760px)_minmax(0,1fr)]">
        <section className="rounded-[24px] bg-soft p-8 max-md:p-5">
          <span className="grid size-14 place-items-center rounded-full bg-raised text-ink">
            <Glyph shape={shapes.circleAlert} size={22} strokeWidth={1.8} />
          </span>
          <h1 className="mt-5 text-[34px] font-[650] tracking-[-0.02em] max-md:text-[28px]">
            Page not found
          </h1>
          <Link
            to="/"
            className="mt-6 inline-flex h-11 items-center rounded-[22px] bg-raised px-5 font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Home
          </Link>
        </section>
        <section aria-labelledby="try-instead">
          <h2 id="try-instead" className="text-[19px] font-semibold">
            Try instead
          </h2>
          <ul className="mt-3">
            {instead.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="flex h-[72px] items-center gap-4 border-b border-line outline-none focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <span className="grid size-11 place-items-center rounded-[14px] bg-soft text-ink">
                    <Glyph shape={item.icon} size={19} strokeWidth={1.8} />
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="font-semibold">{item.title}</span>
                    <span className="text-[14.5px] text-sec">
                      {item.detail}
                    </span>
                  </span>
                  <Glyph
                    shape={shapes.chevronRight}
                    size={16}
                    strokeWidth={2}
                    className="text-sec"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
