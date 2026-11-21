// node --test "scripts/lib/*.test.mjs"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  checkLinks,
  directoriesOf,
  extractLinks,
  resolveTarget,
} from "./markdown-links.mjs"

function targets(text) {
  return extractLinks(text).map((link) => link.target)
}

describe("extractLinks", () => {
  it("finds inline links, images and reference definitions", () => {
    const text = [
      "See [the guide](docs/guide.md) and ![logo](img/logo.png 'Logo').",
      "[ref]: ../other.md",
      "Wrapped [link](<dir/with space.md>).",
    ].join("\n")
    assert.deepEqual(targets(text), [
      "docs/guide.md",
      "img/logo.png",
      "../other.md",
      "dir/with space.md",
    ])
  })

  it("skips code fences, inline code and HTML comments", () => {
    const text = [
      "```md",
      "[in a fence](missing.md)",
      "```",
      "`[inline](missing.md)` and [real](real.md)",
      "<!-- [commented](missing.md) -->",
    ].join("\n")
    assert.deepEqual(targets(text), ["real.md"])
  })

  it("reports the line of each link", () => {
    const links = extractLinks("intro\n\n[a](a.md)")
    assert.equal(links[0].line, 3)
  })

  it("finds links whose text or target wraps across lines", () => {
    const text = [
      "Read [the long",
      "guide](docs/guide.md) and [another](",
      "  docs/other.md",
      '  "Title") and more.',
      "",
      "[label]:",
      "  docs/ref.md",
    ].join("\n")
    assert.deepEqual(extractLinks(text), [
      { line: 1, target: "docs/guide.md" },
      { line: 2, target: "docs/other.md" },
      { line: 7, target: "docs/ref.md" },
    ])
  })

  it("does not join link text across a blank line", () => {
    assert.deepEqual(targets("[one\n\ntwo](x.md)"), [])
  })

  it("closes a fence only on the same character, at least as long", () => {
    const text = [
      "````md",
      "```",
      "[inside](missing.md)",
      "```",
      "~~~~",
      "````",
      "[after](after.md)",
      "~~~",
      "[in tildes](missing.md)",
      "```",
      "~~~",
      "[last](last.md)",
    ].join("\n")
    assert.deepEqual(targets(text), ["after.md", "last.md"])
  })

  it("checks both targets of a badge link", () => {
    assert.deepEqual(targets("[![build](docs/badge.svg)](docs/ci.md)"), [
      "docs/ci.md",
      "docs/badge.svg",
    ])
  })

  it("does not read footnote definitions as links", () => {
    assert.deepEqual(targets("Text.[^1]\n\n[^1]: missing.md says so"), [])
  })

  it("recognises fences indented inside list items", () => {
    const text = [
      "1. Step",
      "",
      "    ```sh",
      "    [not a link](missing.md)",
      "    ```",
      "",
      "2. [next](next.md)",
    ].join("\n")
    assert.deepEqual(targets(text), ["next.md"])
  })

  it("checks href and src in inline HTML", () => {
    const text = [
      '<p align="center"><img src="docs/logo.png" alt="Logo">',
      "<a",
      "  href='docs/a.md'>A</a> <a href=https://example.com>B</a></p>",
    ].join("\n")
    assert.deepEqual(extractLinks(text), [
      { line: 1, target: "docs/logo.png" },
      { line: 3, target: "docs/a.md" },
      { line: 3, target: "https://example.com" },
    ])
  })

  it("does not let a code span hide a later link or open a comment", () => {
    const text = "`` a ` b `` then `<!--` and [real](real.md) `-->`"
    assert.deepEqual(targets(text), ["real.md"])
  })
})

describe("resolveTarget", () => {
  it("resolves relative to the linking file", () => {
    assert.equal(
      resolveTarget("apps/x/README.md", "../y/README.md"),
      "apps/y/README.md",
    )
    assert.equal(resolveTarget("README.md", "apps/x"), "apps/x")
    assert.equal(resolveTarget("README.md", "apps/x/"), "apps/x")
  })

  it("drops anchors and queries and decodes escapes", () => {
    assert.equal(
      resolveTarget("README.md", "CONTRIBUTING.md#sign-off"),
      "CONTRIBUTING.md",
    )
    assert.equal(resolveTarget("README.md", "a%20b.md?x=1"), "a b.md")
  })

  it("ignores URLs, mail and same-file anchors", () => {
    for (const target of [
      "https://example.com/a.md",
      "//example.com/a.md",
      "mailto:someone@example.com",
      "#heading",
    ]) {
      assert.equal(resolveTarget("README.md", target), null)
    }
  })

  it("resolves root-relative links from the repository root", () => {
    assert.equal(resolveTarget("apps/x/README.md", "/docs/a.md"), "docs/a.md")
    assert.equal(resolveTarget("apps/x/README.md", "/"), ".")
    assert.equal(resolveTarget("README.md", "/../a.md"), "../a.md")
  })

  it("skips root-relative site routes in the docs site content", () => {
    assert.equal(
      resolveTarget("packages/docs/content/concepts/a.md", "/concepts/epochs"),
      null,
    )
    assert.equal(
      resolveTarget("packages/docs/content/a.md", "b.md"),
      "packages/docs/content/b.md",
    )
  })
})

describe("checkLinks", () => {
  const files = new Set(["README.md", "apps/x/README.md", "docs/a.md"])
  const context = {
    files,
    directories: directoriesOf(files),
    ignored: ["internal/**"],
  }

  it("passes links to files and directories that exist", () => {
    const text = "[x](apps/x/README.md) [dir](apps/x) [docs](docs/) [top](#top)"
    assert.deepEqual(checkLinks("README.md", text, context), [])
  })

  it("flags a missing file", () => {
    const [finding] = checkLinks("README.md", "[gone](docs/gone.md)", context)
    assert.equal(finding.rule, "missing")
    assert.equal(finding.target, "docs/gone.md")
  })

  it("flags a link into a path the public repository never gets", () => {
    const findings = checkLinks(
      "README.md",
      "[plan](internal/plans/plan.md) [all](internal)",
      context,
    )
    assert.deepEqual(
      findings.map((finding) => finding.rule),
      ["not published", "not published"],
    )
  })

  it("flags a missing root-relative link outside the docs content", () => {
    const findings = checkLinks(
      "apps/x/README.md",
      "[ok](/docs/a.md) [gone](/docs/gone.md)",
      context,
    )
    assert.deepEqual(
      findings.map((finding) => finding.target),
      ["/docs/gone.md"],
    )
  })

  it("flags a missing image inside a badge and in HTML", () => {
    const findings = checkLinks(
      "README.md",
      '[![b](docs/badge.svg)](docs/a.md) <img src="docs/x.png">',
      context,
    )
    assert.deepEqual(
      findings.map((finding) => finding.target),
      ["docs/badge.svg", "docs/x.png"],
    )
  })

  it("flags a link that leaves the repository", () => {
    const [finding] = checkLinks(
      "README.md",
      "[up](../other/README.md)",
      context,
    )
    assert.equal(finding.rule, "outside the repository")
  })
})
