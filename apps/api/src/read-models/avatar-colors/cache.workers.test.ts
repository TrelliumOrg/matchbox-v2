import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { logger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import { readAvatarColors } from "./cache"
import {
  type AvatarTarget,
  defaultExtractBudget,
  resolveAvatarColors,
} from "./extract"
import { fakeImageFetch, solidPng } from "./fixtures"
import legibleColor from "./legible"

const orangeUrl = "https://cdn.example/orange.png"
const blueUrl = "https://cdn.example/blue.png"
const brokenUrl = "https://cdn.example/broken.png"
const images = new Map([
  [orangeUrl, solidPng(8, 8, [247, 147, 26, 255])],
  [blueUrl, solidPng(8, 8, [31, 94, 255, 255])],
  [brokenUrl, new TextEncoder().encode("not an image")],
])
const orange = legibleColor({ r: 247, g: 147, b: 26 })
const blue = legibleColor({ r: 31, g: 94, b: 255 })

function target(
  gaugeAddress: string,
  url: string,
  profileUpdatedAt = "2026-11-01T00:00:00Z",
): AvatarTarget {
  return { gaugeAddress, url, profileUpdatedAt }
}

const targets = [
  target("0xa", orangeUrl),
  target("0xb", blueUrl),
  // Two gauges sharing one picture decode it once.
  target("0xc", orangeUrl),
  target("0xd", brokenUrl),
]

async function resolve(
  list: readonly AvatarTarget[],
  fetcher: ReturnType<typeof fakeImageFetch>["fetcher"],
  maxImages = 12,
  nowMs = Date.UTC(2026, 10, 9),
) {
  return resolveAvatarColors({
    db: env.READ_DB,
    targets: list,
    fetcher,
    budget: { ...defaultExtractBudget, maxImages },
    now: () => nowMs,
    logger,
  })
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await env.READ_DB.prepare("DELETE FROM avatar_colors").run()
})

describe("resolveAvatarColors", () => {
  it("decodes each picture once and serves later runs from D1", async () => {
    const first = fakeImageFetch(images)
    const result = await resolve(targets, first.fetcher)
    expect(first.requests.sort()).toEqual([blueUrl, brokenUrl, orangeUrl])
    expect(result).toMatchObject({
      extracted: 2,
      failed: 1,
      pending: 0,
      writes: 3,
    })
    expect(Object.fromEntries(result.colors)).toEqual({
      "0xa": orange,
      "0xb": blue,
      "0xc": orange,
    })
    const rows = await readAvatarColors(env.READ_DB)
    expect(rows.find((row) => row.url === brokenUrl)).toMatchObject({
      status: "failed",
      detail: "unsupported",
    })

    const second = fakeImageFetch(images)
    const again = await resolve(targets, second.fetcher)
    expect(second.requests).toEqual([])
    expect(again).toMatchObject({ extracted: 0, failed: 0, writes: 0 })
    expect(again.colors).toEqual(result.colors)
  })

  it("re-extracts when the profile changes and drops the stale row", async () => {
    await resolve([target("0xa", orangeUrl)], fakeImageFetch(images).fetcher)
    const changed = fakeImageFetch(images)
    const result = await resolve(
      [target("0xa", blueUrl, "2026-11-05T00:00:00Z")],
      changed.fetcher,
    )
    expect(changed.requests).toEqual([blueUrl])
    expect(result.colors.get("0xa")).toBe(blue)
    // One upsert, one delete.
    expect(result.writes).toBe(2)
    const rows = await readAvatarColors(env.READ_DB)
    expect(rows.map((row) => row.url)).toEqual([blueUrl])
  })

  it("caps the pictures per run and finishes them on later runs", async () => {
    const first = await resolve(targets, fakeImageFetch(images).fetcher, 2)
    expect(first).toMatchObject({ extracted: 1, failed: 1, pending: 1 })
    const second = await resolve(targets, fakeImageFetch(images).fetcher, 2)
    expect(second).toMatchObject({ pending: 0 })
    expect(second.colors.size).toBe(3)
  })

  it("retries a timed-out picture after a day, not before", async () => {
    let calls = 0
    const timingOut = async () => {
      calls += 1
      throw new DOMException("timed out", "TimeoutError")
    }
    const day = 24 * 60 * 60 * 1000
    const start = Date.UTC(2026, 10, 9)
    await resolve([target("0xa", orangeUrl)], timingOut, 12, start)
    await resolve([target("0xa", orangeUrl)], timingOut, 12, start + day / 2)
    expect(calls).toBe(1)
    const later = await resolve(
      [target("0xa", orangeUrl)],
      fakeImageFetch(images).fetcher,
      12,
      start + day,
    )
    expect(later.colors.get("0xa")).toBe(orange)
  })

  it("keeps the cache when the profile read came back empty", async () => {
    await resolve(targets, fakeImageFetch(images).fetcher)
    const result = await resolve([], fakeImageFetch(images).fetcher)
    expect(result.writes).toBe(0)
    expect(await readAvatarColors(env.READ_DB)).toHaveLength(3)
  })
})
