import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ogImage, shareTags } from "./share"

function content(tags: readonly Record<string, string>[], key: string) {
  return tags.find((tag) => tag.property === key || tag.name === key)?.content
}

describe("link previews", () => {
  it("share the 1200x630 card from public/og.png at an absolute address", () => {
    const tags = shareTags("/sign-in", "Sign in")
    expect(content(tags, "og:image")).toBe("https://id.matchbox.markets/og.png")
    expect(content(tags, "og:image:width")).toBe("1200")
    expect(content(tags, "og:image:height")).toBe("630")
    expect(content(tags, "og:image:alt")).toBeTruthy()
    expect(content(tags, "twitter:card")).toBe("summary_large_image")
    expect(content(tags, "og:url")).toBe("https://id.matchbox.markets/sign-in")
    // The tests run from apps/id.
    const file = join(process.cwd(), "public", new URL(ogImage).pathname)
    expect(existsSync(file)).toBe(true)
  })
})
