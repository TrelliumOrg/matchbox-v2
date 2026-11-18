import { type ReactNode, useEffect, useId, useState } from "react"
import { Glyph, shapes } from "../icons"

/**
 * On this page (Doop `cA_kCfY56H`): a 13.5 label, the page's h2 and h3 as
 * links on a 2px rail, the section being read marked in ink with an orange
 * bar, and the reading time under it. `useActiveHeading` follows scrolling
 * with an IntersectionObserver; it is also what the phone page bar shows.
 */

export type Item = { id: string; text: string; depth: 2 | 3 }

/** The id of the heading the reader is in: the last one above the fold. */
export function useActiveHeading(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null)
  const key = ids.join(" ")
  useEffect(() => {
    const list = key === "" ? [] : key.split(" ")
    setActive(list[0] ?? null)
    if (list.length === 0 || typeof IntersectionObserver === "undefined") return
    const headings = list
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        const first = list.find((id) => visible.has(id))
        if (first !== undefined) {
          setActive(first)
          return
        }
        // Between headings: the last one that scrolled above the top.
        const above = headings.filter(
          (heading) => heading.getBoundingClientRect().top < 0,
        )
        const last = above.at(-1)
        if (last !== undefined) setActive(last.id)
      },
      { rootMargin: "0px 0px -60% 0px" },
    )
    for (const heading of headings) observer.observe(heading)
    return () => observer.disconnect()
  }, [key])
  return active
}

export type RootProps = {
  items: readonly Item[]
  active: string | null
  readingMinutes?: number
  label?: string
}

export function Root({
  items,
  active,
  readingMinutes,
  label = "On this page",
}: RootProps): ReactNode {
  const id = useId()
  return (
    <nav aria-labelledby={id} className="text-[14px]">
      <p id={id} className="mt-2 mb-2.5 text-[13.5px] font-medium text-sec">
        {label}
      </p>
      <ul>
        {items.map((item) => {
          const current = item.id === active
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={`block border-l-2 py-1.5 leading-5 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink ${item.depth === 3 ? "pl-[26px]" : "pl-3.5"} ${current ? "border-acc font-semibold text-ink" : "border-line text-sec"}`}
              >
                {item.text}
              </a>
            </li>
          )
        })}
      </ul>
      {readingMinutes === undefined ? null : (
        <p className="mt-[22px] flex items-center gap-2 text-sec">
          <Glyph shape={shapes.clock} size={16} strokeWidth={1.75} />
          <span>
            <span className="sr-only">Reading time </span>
            {readingMinutes} min
          </span>
        </p>
      )}
    </nav>
  )
}
Root.displayName = "Toc.Root"
