import { describe, expect, it } from "vitest"
import { isTerse, metaTags, type Page, pageFor, pageMeta, terse } from "./meta"
import type { DefaultCard, GaugeCard, ProtocolCard } from "./model"

const wei = (whole: number) => `${BigInt(whole) * 10n ** 18n}`

const defaults: DefaultCard = {
  kind: "default",
  epoch: 47,
  endsIn: 230_400,
  incentivesUsd: "1366.52",
  veMezoLocked: wei(282_800_000),
  veBtcLocked: "804.30",
}

const snf: GaugeCard = {
  kind: "gauge",
  epoch: 47,
  address: "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e",
  name: "SNF",
  id: "#6033",
  gaugeKind: "vebtc",
  typeLine: "veBTC gauge, 250.1660 veBTC",
  picture: { kind: "image", url: "https://example.com/snf.png" },
  apyBps: 986,
  incentivesUsd: "310.46",
  incentiveTokens: ["MEZO"],
  boost: { label: "5×", atMax: true },
  band: { fill: 1, atMax: true },
  expired: false,
}

const epoch47: ProtocolCard = {
  kind: "protocol",
  epoch: 47,
  incentivesUsd: "1366.52",
  changeUsd: "401.70",
  bars: [],
}

describe("pageFor", () => {
  it.each<[string, Page]>([
    [
      "/",
      { kind: "section", section: "overview", voteType: null, wallet: null },
    ],
    [
      "/vote",
      { kind: "section", section: "vote", voteType: null, wallet: null },
    ],
    [
      "/vote/pools",
      { kind: "section", section: "vote", voteType: "pool", wallet: null },
    ],
    [
      "/pyke.mezo/rewards",
      {
        kind: "section",
        section: "rewards",
        voteType: null,
        wallet: "pyke.mezo",
      },
    ],
    [
      "/0x5959aBcD00000000000000000000000000000965/activity",
      {
        kind: "section",
        section: "activity",
        voteType: null,
        wallet: "0x5959…0965",
      },
    ],
    [
      "/gauges/0x449B06B9B6C9B649B610105D1A5E337E1D6D3D1E",
      { kind: "gauge", address: "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e" },
    ],
    ["/protocol", { kind: "protocol", epoch: null }],
    ["/protocol/40", { kind: "protocol", epoch: 40 }],
    [
      "/protocol/forty",
      { kind: "section", section: null, voteType: null, wallet: null },
    ],
    [
      "/somewhere/else/entirely",
      { kind: "section", section: null, voteType: null, wallet: null },
    ],
  ])("%s", (path, page) => {
    expect(pageFor(path)).toEqual(page)
  })
})

describe("pageMeta", () => {
  it("titles a gauge by name and type, with figures as the description", () => {
    const meta = pageMeta(pageFor(`/gauges/${snf.address}`), snf)
    expect(meta).toEqual({
      title: "SNF, veBTC gauge, Matchbox Pro",
      description: "9.86% APY, $310.46 incentives, 5× boost, Epoch 47",
      image: `/og/gauge/${snf.address}.png`,
      imageAlt: "SNF, Matchbox Pro",
    })
  })

  it("leaves out figures a gauge does not have", () => {
    const meta = pageMeta(pageFor(`/gauges/${snf.address}`), {
      ...snf,
      gaugeKind: "pool",
      apyBps: null,
      boost: null,
      band: null,
    })
    expect(meta.title).toBe("SNF, Pool gauge, Matchbox Pro")
    expect(meta.description).toBe("$310.46 incentives, Epoch 47")
  })

  it("titles Protocol by epoch with the change", () => {
    const meta = pageMeta(pageFor("/protocol"), epoch47)
    expect(meta).toMatchObject({
      title: "Epoch 47, Protocol, Matchbox Pro",
      description: "$1,366.52 incentives, +$401.70 vs Epoch 46",
      image: "/og/protocol/47.png",
    })
  })

  it("gives every other page the default card and the epoch's figures", () => {
    const meta = pageMeta(pageFor("/pyke.mezo/vote/vebtc"), defaults)
    expect(meta).toEqual({
      title: "pyke.mezo, veBTC gauges, Vote, Matchbox Pro",
      description:
        "$1,366.52 incentives, 282.8M veMEZO locked, 804.30 veBTC locked, Epoch 47",
      image: "/og/default.png",
      imageAlt: "Matchbox Pro",
    })
    expect(pageMeta(pageFor("/"), defaults).title).toBe("Matchbox Pro")
  })

  it("falls back to terse copy when the read models failed", () => {
    for (const path of ["/", "/protocol/40", `/gauges/${snf.address}`]) {
      const meta = pageMeta(pageFor(path), null)
      expect(meta.description).toBe("Vote, claim and lock on Mezo Earn")
    }
    expect(pageMeta(pageFor("/protocol/40"), null).title).toBe(
      "Epoch 40, Protocol, Matchbox Pro",
    )
    expect(pageMeta(pageFor(`/gauges/${snf.address}`), defaults).title).toBe(
      "Gauge, Matchbox Pro",
    )
  })

  it("follows the copy rules even for third-party names", () => {
    const meta = pageMeta(pageFor(`/gauges/${snf.address}`), {
      ...snf,
      name: "Kiln — Labs; Nodes · Two",
    })
    expect(meta.title).toBe("Kiln, Labs, Nodes, Two, veBTC gauge, Matchbox Pro")
    const pages = [
      "/",
      "/vote",
      "/vote/mezo",
      "/vote/validators",
      "/rewards",
      "/activity",
      "/pyke.mezo",
      "/protocol",
      "/protocol/40",
      `/gauges/${snf.address}`,
    ]
    for (const path of pages) {
      for (const card of [defaults, snf, epoch47, null]) {
        const page = pageMeta(pageFor(path), card)
        for (const text of [page.title, page.description, page.imageAlt]) {
          expect(isTerse(text), text).toBe(true)
        }
      }
    }
  })
})

describe("terse", () => {
  it("drops dashes, middle dots and semicolons", () => {
    expect(terse("A – B")).toBe("A, B")
    expect(terse("A;B")).toBe("A, B")
    expect(terse("— A ·")).toBe("A")
    expect(isTerse("9.86% APY, $310.46 incentives, 5× boost")).toBe(true)
    expect(isTerse("A — B")).toBe(false)
  })
})

describe("metaTags", () => {
  const meta = pageMeta(pageFor(`/gauges/${snf.address}`), snf)

  it("writes og and twitter tags absolute on the request's host", () => {
    for (const origin of [
      "https://pro.matchbox.markets",
      "https://beta.matchbox.markets",
    ]) {
      const url = new URL(`${origin}/gauges/${snf.address}?tab=history`)
      const html = metaTags(meta, url, "498399")
      const image = `${origin}/og/gauge/${snf.address}.png?v=498399`
      const tags = Object.fromEntries(
        [
          ...html.matchAll(
            /<meta (?:property|name)="([^"]+)" content="([^"]*)">/g,
          ),
        ].map((match) => [match[1], match[2]]),
      )
      expect(tags).toEqual({
        "og:type": "website",
        "og:site_name": "Matchbox Pro",
        "og:title": "SNF, veBTC gauge, Matchbox Pro",
        "og:description": "9.86% APY, $310.46 incentives, 5× boost, Epoch 47",
        "og:url": `${origin}/gauges/${snf.address}`,
        "og:image": image,
        "og:image:type": "image/png",
        "og:image:width": "1200",
        "og:image:height": "630",
        "og:image:alt": "SNF, Matchbox Pro",
        "twitter:card": "summary_large_image",
        "twitter:title": "SNF, veBTC gauge, Matchbox Pro",
        "twitter:description":
          "9.86% APY, $310.46 incentives, 5× boost, Epoch 47",
        "twitter:image": image,
        "twitter:image:alt": "SNF, Matchbox Pro",
      })
    }
  })

  it("escapes names into attributes", () => {
    const html = metaTags(
      { ...meta, title: 'A "quoted" <b>&</b> name' },
      new URL("https://pro.matchbox.markets/"),
      "1",
    )
    expect(html).toContain(
      'content="A &quot;quoted&quot; &lt;b&gt;&amp;&lt;/b&gt; name"',
    )
  })
})
