import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Every root-relative image or icon the source advertises (favicons, link
 * preview cards, wallet metadata) is a file in public/, so none 404s.
 */

const root = fileURLToPath(new URL("../..", import.meta.url).href)
const assetPattern =
  /["'`(}]\/((?:og\/)?[\w.-]+\.(?:png|svg|ico|jpg|webp))["'`)]/g

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

describe("public assets", () => {
  it("exist for every path the code advertises", () => {
    const advertised = new Set<string>()
    for (const file of sources(join(root, "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(assetPattern)) {
        if (match[1] !== undefined) advertised.add(match[1])
      }
    }
    expect(advertised.size).toBeGreaterThan(0)
    for (const asset of advertised) {
      expect(existsSync(join(root, "public", asset)), asset).toBe(true)
    }
  })
})
