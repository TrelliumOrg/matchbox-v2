import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { rootHead, ThemeColor } from "./root-document"

describe("theme-color", () => {
  it("renders both schemes' colours", () => {
    const html = renderToStaticMarkup(<ThemeColor />)
    expect(html.match(/name="theme-color"/g)).toHaveLength(2)
    expect(html).toContain(
      'content="#ffffff" media="(prefers-color-scheme: light)"',
    )
    expect(html).toContain(
      'content="#121212" media="(prefers-color-scheme: dark)"',
    )
  })

  it("is no longer left to head(), where de-duplication dropped the light one", () => {
    const head = rootHead({
      title: "Matchscan",
      description: "x",
      font: "/f.woff2",
      stylesheet: "/s.css",
    })
    expect(head.meta.filter((meta) => meta.name === "theme-color")).toEqual([])
  })
})
