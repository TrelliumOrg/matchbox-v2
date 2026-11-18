import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import * as Callout from "./callout"
import * as CodeBlock from "./code-block"
import { presetNames, tokenContrast } from "./contrast"
import * as Definition from "./definition"
import * as DocFigure from "./doc-figure"
import * as DocsLockup from "./docs-lockup"
import { shapes } from "./icons"
import * as OperationHeader from "./operation-header"
import * as PageBar from "./page-bar"
import * as PrevNext from "./prev-next"
import * as Prose from "./prose"
import * as SchemaTree from "./schema-tree"
import * as Steps from "./steps"
import * as Toc from "./toc"
import * as VersionPill from "./version-pill"

/**
 * The docs components (Doop page "Matchbox Docs"): structure and keyboard
 * use for WCAG 2.2 AA, and every colour pair they draw checked against the
 * theme tokens in all eight presets.
 */

afterEach(cleanup)

// happy-dom gives import.meta.url no file scheme: resolve from the package.
const css = readFileSync(
  join(process.cwd(), "../tokens/src/themes.css"),
  "utf8",
)

describe("docs colours meet WCAG 2.2 AA in every preset", () => {
  // [text, background, minimum]: 4.5 for text, 3 for icons and large text.
  const pairs: readonly (readonly [string, string, number, string])[] = [
    ["ink2", "bg", 4.5, "body text"],
    ["ink", "bg", 4.5, "titles and links"],
    ["sec", "bg", 4.5, "eyebrows, On this page, captions"],
    ["ink2", "soft", 4.5, "code and note callouts"],
    ["sec", "soft", 4.5, "code comments, tree group labels on cards"],
    ["accInk", "soft", 4.5, "code strings and numbers"],
    ["ink", "soft2", 4.5, "inline code"],
    ["ink2", "accSoft", 4.5, "warning callout text"],
    ["accInk", "accSoft", 4.5, "Ask about this page, Matchscan tab"],
    ["ink2", "negSoft", 4.5, "danger callout text"],
    ["neg", "negSoft", 3, "danger callout icon"],
    ["onTip", "tip", 4.5, "definition popover"],
    ["onMezo", "mezo", 4.5, "Matchbox Pro tab"],
    ["bg", "ink", 4.5, "Matchbox ID tab"],
    ["bg", "ink2", 4.5, "Matchbox Developer tab"],
    ["bg", "ink", 4.5, "figure markers"],
  ]
  for (const preset of presetNames) {
    for (const [text, background, minimum, use] of pairs) {
      it(`${preset}: ${text} on ${background} (${use})`, () => {
        expect(
          tokenContrast(css, preset, text, background),
        ).toBeGreaterThanOrEqual(minimum)
      })
    }
  }
})

describe("DocsLockup", () => {
  it("names itself and draws the short form narrower", () => {
    render(<DocsLockup.Root form="full" />)
    expect(screen.getByRole("img", { name: "Matchbox Docs" })).toBeTruthy()
    expect(DocsLockup.width("short", 22)).toBeLessThan(
      DocsLockup.width("full", 22),
    )
    expect(DocsLockup.width("icon", 22)).toBeLessThan(
      DocsLockup.width("short", 22),
    )
  })
})

describe("Prose", () => {
  it("keeps heading ids for anchors", () => {
    render(
      <Prose.Root>
        <Prose.Title>Vote</Prose.Title>
        <Prose.H2 id="cast-a-vote">Cast a vote</Prose.H2>
      </Prose.Root>,
    )
    expect(screen.getByRole("heading", { level: 1, name: "Vote" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2 }).id).toBe("cast-a-vote")
  })
})

describe("CodeBlock", () => {
  const snippet = (label: string, source: string): CodeBlock.Snippet => ({
    label,
    source,
    lines: [[[source, "k"]]],
  })

  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup()
    render(
      <CodeBlock.Root
        snippets={[
          snippet("TypeScript", "const a = 1"),
          snippet("curl", "curl x"),
        ]}
      />,
    )
    const tabs = screen.getAllByRole("tab")
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true")
    tabs[0]?.focus()
    await user.keyboard("{ArrowRight}")
    expect(
      screen.getByRole("tab", { name: "curl" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "curl" }),
    )
    expect(screen.getByRole("tabpanel").textContent).toContain("curl x")
  })

  it("shows a file name for one snippet and copies from the keyboard", async () => {
    const user = userEvent.setup()
    let copied = ""
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text
        },
      },
    })
    render(<CodeBlock.Root snippets={[snippet("vote.json", "{}")]} />)
    expect(screen.queryByRole("tablist")).toBeNull()
    expect(screen.getByText("vote.json")).toBeTruthy()
    screen.getByRole("button", { name: "Copy code" }).focus()
    await user.keyboard("{Enter}")
    expect(copied).toBe("{}")
    expect(screen.getByRole("status").textContent).toBe("Copied")
  })

  it("lets the code region take focus to scroll", () => {
    render(<CodeBlock.Root snippets={[snippet("a.ts", "x")]} />)
    expect(document.querySelector("pre")?.getAttribute("tabindex")).toBe("0")
    expect(screen.getByRole("switch", { name: "Wrap lines" })).toBeTruthy()
  })
})

describe("Callout", () => {
  it("is a named complementary region", () => {
    render(
      <Callout.Root tone="warning" title="Saved, not signed">
        <p>Body</p>
      </Callout.Root>,
    )
    expect(
      screen.getByRole("complementary", { name: "Saved, not signed" }),
    ).toBeTruthy()
  })
})

describe("Steps", () => {
  it("is an ordered list with a heading per step", () => {
    render(
      <Steps.Root>
        <Steps.Item title="Lock">One</Steps.Item>
        <Steps.Item title="Vote" tag="Server">
          Two
        </Steps.Item>
      </Steps.Root>,
    )
    expect(screen.getByRole("list").tagName).toBe("OL")
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByRole("heading", { level: 3, name: /Vote/ })).toBeTruthy()
  })
})

describe("Definition", () => {
  it("opens on click and closes with Escape", async () => {
    const user = userEvent.setup()
    render(
      <p>
        Each{" "}
        <Definition.Root
          title="Epoch"
          definition="One week."
          link={<a href="/concepts/epochs">Epochs</a>}
        >
          epoch
        </Definition.Root>
      </p>,
    )
    const term = screen.getByRole("button", { name: "epoch" })
    expect(term.getAttribute("aria-expanded")).toBe("false")
    await user.click(term)
    expect(term.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("dialog", { name: "Epoch" }).textContent).toContain(
      "One week.",
    )
    await user.keyboard("{Escape}")
    expect(term.getAttribute("aria-expanded")).toBe("false")
  })
})

describe("DocFigure", () => {
  it("labels the picture and hides the markers from screen readers", () => {
    render(
      <DocFigure.Root label="The Vote screen" caption="Caption">
        <DocFigure.Marker number={1} x={10} y={10} />
      </DocFigure.Root>,
    )
    expect(screen.getByRole("img", { name: "The Vote screen" })).toBeTruthy()
    expect(screen.getByText("1").getAttribute("aria-hidden")).toBe("true")
  })
})

describe("Toc", () => {
  it("marks the current section", () => {
    render(
      <Toc.Root
        items={[
          { id: "a", text: "First", depth: 2 },
          { id: "b", text: "Second", depth: 3 },
        ]}
        active="b"
        readingMinutes={4}
      />,
    )
    expect(
      screen.getByRole("navigation", { name: "On this page" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Second" }).getAttribute("aria-current"),
    ).toBe("location")
    expect(screen.getByText("4 min")).toBeTruthy()
  })
})

describe("PrevNext", () => {
  it("renders the given links with rel", () => {
    render(
      <PrevNext.Root>
        <PrevNext.Item direction="previous">
          <a href="/a">
            <PrevNext.Content direction="previous" title="Overview" />
          </a>
        </PrevNext.Item>
        <PrevNext.Item direction="next">
          <a href="/b">
            <PrevNext.Content direction="next" title="Optimize" />
          </a>
        </PrevNext.Item>
      </PrevNext.Root>,
    )
    expect(
      screen.getByRole("link", { name: /Optimize/ }).getAttribute("rel"),
    ).toBe("next")
    expect(
      screen.getByRole("link", { name: /Overview/ }).getAttribute("rel"),
    ).toBe("prev")
  })
})

describe("OperationHeader and SchemaTree", () => {
  it("shows the method, path and properties", () => {
    render(
      <>
        <OperationHeader.Root method="GET" path="/v1/incentives" />
        <OperationHeader.Meta
          items={[
            { icon: shapes.keyRound, label: "Authentication", text: "API key" },
          ]}
        />
      </>,
    )
    expect(screen.getByText("/v1/incentives")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy path" })).toBeTruthy()
    expect(screen.getByText("Authentication:")).toBeTruthy()
  })

  it("folds nested objects into a disclosure", () => {
    render(
      <SchemaTree.Root
        fields={[
          {
            name: "data",
            type: "array of Gauge",
            required: true,
            description: "",
            values: [],
            children: [
              {
                name: "rewards",
                type: "array of Reward",
                required: true,
                description: "",
                values: [],
                children: [
                  {
                    name: "kind",
                    type: "string",
                    required: true,
                    description: "",
                    values: ["fees"],
                    children: [],
                  },
                ],
              },
            ],
          },
        ]}
      />,
    )
    expect(screen.getAllByText("Required")).toHaveLength(3)
    expect(screen.getByText("1 fields").closest("summary")).toBeTruthy()
  })
})

describe("VersionPill and PageBar", () => {
  it("names the version and opens On this page", async () => {
    const user = userEvent.setup()
    let opened = false
    render(
      <>
        <VersionPill.Root major="v1" version="2.1.0" />
        <PageBar.Root
          current="Cast a vote"
          onOpen={() => {
            opened = true
          }}
          action={null}
        />
      </>,
    )
    expect(screen.getByText("API version")).toBeTruthy()
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /On this page/ }))
    })
    expect(opened).toBe(true)
  })
})
