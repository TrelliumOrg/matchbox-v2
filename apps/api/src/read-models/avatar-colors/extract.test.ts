import type { GaugeProfile } from "@matchbox/contracts/gauge-profiles"
import { describe, expect, it } from "vitest"
import {
  avatarTargets,
  defaultExtractBudget,
  extractAvatarColor,
} from "./extract"
import { fakeImageFetch, solidPng } from "./fixtures"
import legibleColor from "./legible"

const url = "https://cdn.example/avatar.png"
const orangePng = solidPng(8, 8, [247, 147, 26, 255])

describe("extractAvatarColor", () => {
  it("fetches, decodes and returns the legible brand colour", async () => {
    const { fetcher } = fakeImageFetch(new Map([[url, orangePng]]))
    expect(
      await extractAvatarColor(url, fetcher, defaultExtractBudget),
    ).toEqual({
      status: "ok",
      color: legibleColor({ r: 247, g: 147, b: 26 }),
      detail: "brand",
    })
  })

  it("fails on HTTP errors, oversize bodies and unknown formats", async () => {
    const { fetcher } = fakeImageFetch(new Map())
    expect(
      await extractAvatarColor(url, fetcher, defaultExtractBudget),
    ).toEqual({
      status: "failed",
      color: null,
      detail: "http-404",
    })
    const small = { ...defaultExtractBudget, maxBytes: 100 }
    const declared = async () =>
      new Response(orangePng, { headers: { "content-length": "999999" } })
    expect(await extractAvatarColor(url, declared, small)).toMatchObject({
      detail: "too-large",
    })
    // No content-length: the stream is cut at the limit.
    const streamed = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(orangePng)
            controller.close()
          },
        }),
      )
    expect(await extractAvatarColor(url, streamed, small)).toMatchObject({
      detail: "too-large",
    })
    const svg = async () => new Response("<svg/>")
    expect(
      await extractAvatarColor(url, svg, defaultExtractBudget),
    ).toMatchObject({ status: "failed", detail: "unsupported" })
  })

  it("reports timeouts and network errors as such", async () => {
    const timeout = async () => {
      throw new DOMException("timed out", "TimeoutError")
    }
    expect(
      await extractAvatarColor(url, timeout, defaultExtractBudget),
    ).toMatchObject({ detail: "timeout" })
    const offline = async () => {
      throw new TypeError("fetch failed")
    }
    expect(
      await extractAvatarColor(url, offline, defaultExtractBudget),
    ).toMatchObject({ detail: "network" })
  })
})

describe("avatarTargets", () => {
  it("keeps only https pictures", () => {
    const profile = (avatarUrl: string | null): GaugeProfile => ({
      profileType: "boost-gauge",
      vebtcTokenId: "2",
      network: "mezo",
      gaugeAddress: "0x1000000000000000000000000000000000000001",
      displayName: null,
      description: null,
      avatarUrl,
      brandColor: null,
      websiteUrl: null,
      socialLinks: {},
      tags: [],
      incentiveStrategy: null,
      votingStrategy: null,
      isFeatured: false,
      chain: {
        isAlive: true,
        nftOwner: null,
        beneficiary: null,
        poolAddress: null,
        checkedAt: null,
        blockNumber: null,
      },
      updatedAt: "2026-11-01T00:00:00Z",
      createdAt: "2026-10-01T00:00:00Z",
    })
    expect(
      avatarTargets([
        profile(url),
        profile("http://insecure.example/a.png"),
        profile(null),
      ]),
    ).toEqual([
      {
        gaugeAddress: "0x1000000000000000000000000000000000000001",
        url,
        profileUpdatedAt: "2026-11-01T00:00:00Z",
      },
    ])
  })
})
