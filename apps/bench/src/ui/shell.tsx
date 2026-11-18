import * as Callout from "@matchbox/ui/callout"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import results from "../data/results"
import { day } from "../view/model"
import BenchLockup from "./lockup"

/**
 * The page around every route: the header with the lockup, the four
 * sections and the run; the sample notice when the file is a sample; the
 * footer.
 */

const nav = [
  { to: "/", label: "Leaderboard" },
  { to: "/questions", label: "Questions" },
  { to: "/method", label: "Method" },
  { to: "/runs", label: "Runs" },
] as const

export const outbound = [
  { href: "https://pro.matchbox.markets", label: "Matchbox Pro" },
  { href: "https://scan.matchbox.markets", label: "Matchscan" },
  { href: "https://docs.matchbox.markets", label: "Documentation" },
] as const

const focus =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

function Header(): ReactNode {
  const { run, entries } = results
  return (
    <header className="border-b border-soft2">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-8 gap-y-2 px-4 pt-4 pb-2 md:h-[76px] md:flex-nowrap md:px-10 md:py-0 xl:px-[120px]">
        <Link to="/" className={`rounded-md ${focus}`}>
          <BenchLockup />
        </Link>
        <p className="ml-auto flex items-center gap-2.5 font-mono text-[12.5px] text-sec md:order-last md:text-[13.5px]">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${run.sample === true ? "bg-acc" : "bg-pos"}`}
          />
          <span>
            Run {run.id}
            <span className="max-sm:hidden">
              , {day(run.finishedAt)}, {entries.length} entries
            </span>
          </span>
        </p>
        <nav
          aria-label="Sections"
          className="-mx-4 w-[calc(100%+32px)] overflow-x-auto px-4 md:mx-0 md:w-auto md:px-0"
        >
          <ul className="flex gap-0.5">
            {nav.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: true }}
                  className={`flex h-10 items-center rounded-[20px] px-3 text-[15.5px] font-medium whitespace-nowrap text-ink2 hover:bg-soft data-[status=active]:bg-soft data-[status=active]:font-semibold data-[status=active]:text-ink ${focus}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}

/** Shown on every page while the file is a sample. */
export function SampleNotice(): ReactNode {
  if (results.run.sample !== true) return null
  return (
    <Callout.Root tone="warning" title="Sample figures" className="mt-6">
      Every number, question and answer on this site is made up to build the
      page. None of it is a result from any model. The first real run replaces
      it.
    </Callout.Root>
  )
}

function Footer(): ReactNode {
  return (
    <footer className="mt-[72px] border-t border-soft2">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-7 gap-y-4 px-4 pt-7 pb-[60px] text-[14.5px] text-sec md:px-10 xl:px-[120px]">
        <BenchLockup height={18} />
        <span>Not affiliated with any model provider.</span>
        <ul className="flex flex-wrap gap-x-[22px] gap-y-2 md:ml-auto">
          {outbound.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className={`rounded-sm hover:text-ink ${focus}`}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}

export function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <a
        href="#content"
        className="sr-only rounded-full bg-ink px-4 py-2 text-bg focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-20"
      >
        Skip to content
      </a>
      <Header />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto max-w-[1200px] px-4 outline-none md:px-10 xl:px-0"
      >
        <SampleNotice />
        {children}
      </main>
      <Footer />
    </>
  )
}

/** A section heading with its line, as in the design (`.sh`). */
export function SectionHead({
  id,
  title,
  lede,
  children,
}: {
  id: string
  title: string
  lede?: string
  children?: ReactNode
}): ReactNode {
  return (
    <div className="mt-14 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h2
          id={id}
          className="text-[24px] font-[650] tracking-[-0.015em] text-ink md:text-[26px]"
        >
          {title}
        </h2>
        {lede === undefined ? null : (
          <p className="mt-1.5 text-[15px] text-sec">{lede}</p>
        )}
      </div>
      {children}
    </div>
  )
}

/** The h1 and lede of the inner pages. */
export function PageHead({
  title,
  lede,
}: {
  title: string
  lede: string
}): ReactNode {
  return (
    <div className="pt-10 md:pt-14">
      <h1 className="text-[36px] leading-[1.05] font-[650] tracking-[-0.03em] text-ink md:text-[48px]">
        {title}
      </h1>
      <p className="mt-4 max-w-[680px] text-[17px] leading-normal text-ink2 md:text-[19px]">
        {lede}
      </p>
    </div>
  )
}
