import { describe, expect, it } from "vitest"
import { search, uniqueTerms } from "../search"
import { lintHeading, lintMarkdown, lintParagraph, lintText } from "./copy-lint"
import { type MarkdownContext, parseMarkdown, renderMarkdown } from "./markdown"
import { docsVoice, slugify, splitImports } from "./reference"

const context: MarkdownContext = {
  file: "test.md",
  tables: {},
  term: (to) => ({ title: "Epoch", definition: "One week.", href: to }),
}

async function render(markdown: string) {
  return renderMarkdown(parseMarkdown(markdown), context)
}

describe("markdown", () => {
  it("keeps explicit heading ids and builds the table of contents", async () => {
    const page = await render("## Cast a vote {#cast}\n\nText.\n\n### Detail\n")
    expect(page.toc).toEqual([
      { id: "cast", text: "Cast a vote", depth: 2 },
      { id: "detail", text: "Detail", depth: 3 },
    ])
    expect(page.body[0]).toEqual({
      t: "h2",
      p: { id: "cast" },
      c: ["Cast a vote"],
    })
  })

  it("fails on a duplicate anchor", async () => {
    await expect(render("## A {#x}\n\n## B {#x}\n")).rejects.toThrow(
      "Duplicate anchor #x",
    )
  })

  it("reads callouts, steps, links and terms", async () => {
    const page = await render(
      [
        ":::note[Votes carry over]",
        "A lock keeps its votes.",
        ":::",
        "",
        "::::steps",
        ':::step[Lock]{tag="Server"}',
        "Lock BTC.",
        ":::",
        "::::",
        "",
        'Each :term[epoch]{to="/concepts/epochs"} counts.',
      ].join("\n"),
    )
    expect(page.body[0]).toMatchObject({
      t: "callout",
      p: { tone: "note", title: "Votes carry over" },
    })
    expect(page.body[1]).toMatchObject({
      t: "steps",
      c: [{ t: "step", p: { title: "Lock", tag: "Server" } }],
    })
    expect(page.links).toContain("/concepts/epochs")
  })

  it("keeps times like 00:00 as text", async () => {
    const page = await render("Starts Thursday 00:00 UTC.")
    expect(page.body[0]).toEqual({ t: "p", c: ["Starts Thursday 00:00 UTC."] })
  })

  it("highlights code at build time into token classes", async () => {
    const page = await render('```ts title="a.ts"\nconst a = "x"\n```')
    const code = page.body[0]
    if (typeof code === "string" || code?.t !== "pre")
      throw new Error("no code")
    expect(code.p.title).toBe("a.ts")
    expect(code.lines[0]?.some(([, kind]) => kind === "s")).toBe(true)
    expect(page.samples).toEqual(['const a = "x"'])
  })

  it("rejects raw HTML and unknown directives", async () => {
    await expect(render("<div>x</div>")).rejects.toThrow("Unsupported Markdown")
    await expect(render("::nope")).rejects.toThrow("Unknown directive")
  })
})

describe("copy lint", () => {
  it("bans dashes, middle dots, semicolons, exclamation marks and bribes", () => {
    expect(lintText("one — two")).toHaveLength(1)
    expect(lintText("1–2")).toEqual(["Replace the en dash with 'to'"])
    expect(lintText("a · b")).toHaveLength(1)
    expect(lintText("a; b")).toHaveLength(1)
    expect(lintText("Done!")).toHaveLength(1)
    expect(lintText("Post bribes")).toEqual([
      "Write 'incentives', never 'bribes'",
    ])
    expect(lintText("Plain words, short sentences.")).toEqual([])
  })

  it("allows two sentences of about 25 words", () => {
    expect(lintParagraph("One. Two.")).toEqual([])
    expect(lintParagraph("One. Two. Three.")).toHaveLength(1)
    expect(lintParagraph(`${"word ".repeat(31)}end.`)).toHaveLength(1)
  })

  it("wants sentence case headings without numbers", () => {
    expect(lintHeading("Cast a vote")).toEqual([])
    expect(lintHeading("Signing with a Safe")).toEqual([])
    expect(lintHeading("Cast A Vote")).not.toEqual([])
    expect(lintHeading("1. Install")).not.toEqual([])
    expect(lintHeading("BEFORE YOU VOTE")).not.toEqual([])
  })

  it("exempts code and URLs", () => {
    const problems = lintMarkdown(
      parseMarkdown(
        "Use `a; b` and [x](https://a.b/c;d).\n\n```ts\nconst a = 1;\n```",
      ),
    )
    expect(problems).toEqual([])
  })
})

describe("search", () => {
  const index = {
    version: 1 as const,
    entries: [
      {
        u: "/pro/vote",
        t: "Vote",
        p: "Matchbox Pro",
        s: "pro" as const,
        k: "page" as const,
        x: "",
        w: uniqueTerms("split votes across gauges"),
      },
      {
        u: "/pro/vote#optimize",
        t: "Optimize",
        p: "Vote",
        s: "pro" as const,
        k: "heading" as const,
        x: "",
        w: uniqueTerms("best split"),
      },
      {
        u: "/concepts/epochs",
        t: "Epochs",
        p: "Concepts",
        s: "concepts" as const,
        k: "page" as const,
        x: "",
        w: uniqueTerms("weekly vote windows"),
      },
    ],
  }

  it("matches every term, the last as a prefix, titles first", () => {
    expect(search(index, "vot").map((hit) => hit.entry.u)).toEqual([
      "/pro/vote",
      "/pro/vote#optimize",
      "/concepts/epochs",
    ])
    expect(search(index, "best spl").map((hit) => hit.entry.u)).toEqual([
      "/pro/vote#optimize",
    ])
    expect(search(index, "zz")).toEqual([])
  })
})

describe("reference helpers", () => {
  it("puts generated text in the docs voice", () => {
    expect(docsVoice("`usd` is null; `totalUsd` sums")).toBe(
      "`usd` is null. `totalUsd` sums",
    )
    expect(docsVoice("a; every key")).toBe("a. Every key")
  })

  it("slugs and splits samples", () => {
    expect(slugify("Gauge profiles")).toBe("gauge-profiles")
    const { imports, body } = splitImports(
      'import {\n  a,\n} from "x"\n\nconst b = a',
    )
    expect(imports).toHaveLength(1)
    expect(body).toBe("const b = a")
  })
})
