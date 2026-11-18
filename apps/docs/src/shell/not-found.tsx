import type { SearchHit } from "@matchbox/docs/search"
import { sectionById } from "@matchbox/docs/site"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as Prose from "@matchbox/ui/prose"
import { type ReactNode, useEffect, useState } from "react"
import { DocLink } from "../content/doc-link"
import { loadIndex, searchIndex } from "../search/load-index"
import { DogDisc } from "./dog"
import { search } from "./store"

/**
 * Page not found (Doop `i4pzhTMEQu`). One static page serves every miss,
 * so the path and the likely pages are worked out in the browser: the
 * missing path's words are searched in the docs index.
 */

function wordsOf(path: string): string {
  return path
    .split(/[/_.-]+/)
    .filter((word) => word !== "" && word !== "docs")
    .join(" ")
}

export function NotFoundPage(): ReactNode {
  const [path, setPath] = useState<string | null>(null)
  const [hits, setHits] = useState<SearchHit[]>([])
  useEffect(() => {
    const missing = window.location.pathname
    setPath(missing === "/404" ? null : missing)
    const words = wordsOf(missing)
    if (words === "" || missing === "/404") return
    loadIndex()
      .then((index) => {
        // Any word may match: the old path's words, one at a time.
        const found = new Map<string, SearchHit>()
        for (const word of words.split(" ")) {
          for (const hit of searchIndex(index, word, 6)) {
            if (hit.entry.k !== "heading" && !found.has(hit.entry.u))
              found.set(hit.entry.u, hit)
          }
        }
        setHits(
          [...found.values()].sort((a, b) => b.score - a.score).slice(0, 3),
        )
      })
      .catch(() => setHits([]))
  }, [])
  const query = path === null ? "" : wordsOf(path)
  return (
    <main
      id="content"
      tabIndex={-1}
      className="px-5 pt-16 pb-24 outline-none md:px-10 md:pt-[110px]"
    >
      <div className="mx-auto max-w-[640px]">
        <Prose.Title className="mt-0">Page not found</Prose.Title>
        <p data-missing-path="" className="mt-2 min-h-6 text-[16px] text-sec">
          {path === null ? null : (
            <>
              Nothing lives at{" "}
              <code className="font-mono text-ink2">{path}</code>
            </>
          )}
        </p>
        <button
          type="button"
          data-search-trigger=""
          onClick={() => search.open(query)}
          onPointerEnter={search.warm}
          className="mt-[30px] flex h-[60px] w-full cursor-pointer items-center gap-3 rounded-[30px] bg-soft pr-3.5 pl-3 text-left text-[17px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          <DogDisc size={38} className="bg-bg dark:bg-bg dark:text-ink" />
          <span
            data-search-query=""
            className={`flex-1 ${query === "" ? "text-sec" : "text-ink"}`}
          >
            {query === "" ? "Ask Stuart or search docs" : query}
          </span>
        </button>
        <div data-likely="" hidden={hits.length === 0}>
          <p className="mt-10 text-[14.5px] text-sec">Likely</p>
          <ul className="mt-2">
            {hits.map((hit) => (
              <li key={hit.entry.u}>
                <DocLink
                  href={hit.entry.u}
                  className="-mx-3 flex items-center gap-4 rounded-[20px] px-3 py-3 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-12 flex-none place-items-center rounded-full bg-soft text-ink2"
                  >
                    <Glyph
                      shape={shapes.fileText}
                      size={19}
                      strokeWidth={1.75}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-ink">
                      {hit.entry.t}
                    </span>
                    <span className="block text-[14.5px] text-sec">
                      {sectionById(hit.entry.s).name}
                    </span>
                  </span>
                  <Glyph
                    shape={shapes.chevronRight}
                    size={18}
                    strokeWidth={1.75}
                    className="flex-none text-sec"
                  />
                </DocLink>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-8">
          <DocLink
            href="/"
            className={`text-[15px] font-semibold ${Prose.linkClass}`}
          >
            Docs home
          </DocLink>
        </p>
      </div>
    </main>
  )
}
