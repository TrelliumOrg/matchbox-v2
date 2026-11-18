import type { GaugeKind } from "../data/view-models"
import { gaugeKinds, kindForSegment } from "../features/gauge/kinds"
import { parseEpochParam } from "../features/protocol/epoch-param"
import {
  formatApy,
  formatCompactVotes,
  formatDecimal,
  formatSignedUsd,
  formatUsd,
  isAddress,
  shortAddress,
} from "../lib/format"
import { parseWalletSegment } from "../lib/wallet-path"
import type { Card, DefaultCard, GaugeCard, ProtocolCard } from "./model"

/**
 * Link preview meta for every page: which card a URL gets, its title and
 * description (terse, figures only, house copy rules), and the og and
 * twitter tags the Worker writes into <head>. Pure, so every rule is tested.
 */

export const siteName = "Matchbox Pro"

export type Section = "overview" | "vote" | "rewards" | "activity"

export type Page =
  | { kind: "gauge"; address: string }
  | { kind: "protocol"; epoch: number | null }
  | {
      kind: "section"
      /** Null for pages outside the four sections. */
      section: Section | null
      voteType: GaugeKind | null
      /** "pyke.mezo" or "0x5959…0965" on another wallet's pages. */
      wallet: string | null
    }

const sections: Record<string, Section> = {
  vote: "vote",
  rewards: "rewards",
  activity: "activity",
}

/** Which page a public path is (`/pyke.mezo/vote/vebtc`, `/gauges/0x…`). */
export function pageFor(pathname: string): Page {
  const segments = pathname.split("/").filter(Boolean)
  const prefix =
    segments[0] === undefined ? null : parseWalletSegment(segments[0])
  const wallet =
    prefix === null
      ? null
      : prefix.kind === "name"
        ? prefix.name
        : shortAddress(prefix.address)
  const [first, second, ...rest] =
    prefix === null ? segments : segments.slice(1)
  const other: Page = {
    kind: "section",
    section: null,
    voteType: null,
    wallet,
  }
  if (rest.length > 0) return other
  if (prefix === null && first === "gauges" && isAddress(second)) {
    return { kind: "gauge", address: second.toLowerCase() }
  }
  if (prefix === null && first === "protocol") {
    if (second === undefined) return { kind: "protocol", epoch: null }
    const epoch = parseEpochParam(second)
    return epoch === null ? other : { kind: "protocol", epoch }
  }
  if (first === undefined) return { ...other, section: "overview" }
  const section = sections[first]
  if (section === undefined) return other
  if (second === undefined) return { ...other, section }
  if (section !== "vote") return other
  return { ...other, section, voteType: kindForSegment(second) }
}

const forbidden = /[–—·;]/

/** House copy rules: no em or en dashes, middle dots or semicolons. */
export function isTerse(text: string): boolean {
  return !forbidden.test(text)
}

/** Third-party text (gauge names) made to follow the rules. */
export function terse(text: string): string {
  return text
    .replace(/\s*[–—·;]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[, ]+|[, ]+$/g, "")
}

export type PageMeta = {
  title: string
  description: string
  /** The card's path on this host, "/og/gauge/0x….png". */
  image: string
  imageAlt: string
}

/** Used when the read models failed: still true, still terse. */
const fallbackDescription = "Vote, claim and lock on Mezo Earn"

function title(...parts: (string | null)[]): string {
  return [...parts.filter((part) => part !== null), siteName].join(", ")
}

function joined(parts: (string | null)[]): string {
  return parts.filter((part) => part !== null).join(", ")
}

function defaultDescription(card: DefaultCard | null): string {
  if (card === null || card.incentivesUsd === null) return fallbackDescription
  return joined([
    `${formatUsd(card.incentivesUsd, "cents")} incentives`,
    card.veMezoLocked === null
      ? null
      : `${formatCompactVotes(card.veMezoLocked)} veMEZO locked`,
    card.veBtcLocked === null
      ? null
      : `${formatDecimal(card.veBtcLocked, 2)} veBTC locked`,
    `Epoch ${card.epoch}`,
  ])
}

function gaugeDescription(card: GaugeCard): string {
  return joined([
    card.apyBps === null ? null : `${formatApy(card.apyBps)} APY`,
    `${formatUsd(card.incentivesUsd, "cents")} incentives`,
    card.boost === null ? null : `${card.boost.label} boost`,
    card.expired ? "Lock expired" : null,
    `Epoch ${card.epoch}`,
  ])
}

function protocolDescription(card: ProtocolCard): string {
  return joined([
    `${formatUsd(card.incentivesUsd, "cents")} incentives`,
    `${formatSignedUsd(card.changeUsd, "cents")} vs Epoch ${card.epoch - 1}`,
  ])
}

const sectionNames: Record<Section, string | null> = {
  overview: null,
  vote: "Vote",
  rewards: "Rewards",
  activity: "Activity",
}

function sectionTitle(page: Extract<Page, { kind: "section" }>): string {
  const type = page.voteType === null ? null : gaugeKinds[page.voteType].label
  return title(
    page.wallet,
    type,
    page.section === null ? null : sectionNames[page.section],
  )
}

function asDefault(card: Card | null): DefaultCard | null {
  return card?.kind === "default" ? card : null
}

/**
 * A page's meta from the card it previews. `card` is the page's own card
 * (gauge or Protocol), the default card, or null when nothing loaded.
 */
export function pageMeta(page: Page, card: Card | null): PageMeta {
  if (page.kind === "gauge") {
    if (card?.kind === "gauge") {
      const name = terse(card.name)
      return {
        title: title(name, gaugeKinds[card.gaugeKind].singular),
        description: gaugeDescription(card),
        image: `/og/gauge/${page.address}.png`,
        imageAlt: title(name),
      }
    }
    return {
      title: title("Gauge"),
      description: defaultDescription(asDefault(card)),
      image: `/og/gauge/${page.address}.png`,
      imageAlt: siteName,
    }
  }
  if (page.kind === "protocol") {
    const found = card?.kind === "protocol" ? card : null
    const epoch = found?.epoch ?? page.epoch
    const named = epoch === null ? null : `Epoch ${epoch}`
    return {
      title: title(named, "Protocol"),
      description:
        found === null
          ? defaultDescription(asDefault(card))
          : protocolDescription(found),
      image: `/og/protocol/${epoch ?? "latest"}.png`,
      imageAlt: title(named === null ? null : `${named} incentives`),
    }
  }
  return {
    title: sectionTitle(page),
    description: defaultDescription(asDefault(card)),
    image: "/og/default.png",
    imageAlt: siteName,
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function property(name: string, content: string): string {
  return `<meta property="${name}" content="${escapeAttribute(content)}">`
}

function named(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeAttribute(content)}">`
}

/**
 * The og and twitter tags for <head>, absolute on the request's host so
 * pro and beta each preview themselves. `version` changes with the hour so
 * platforms that cache images by URL refetch the figures.
 */
export function metaTags(meta: PageMeta, url: URL, version: string): string {
  const image = `${url.origin}${meta.image}?v=${encodeURIComponent(version)}`
  return [
    property("og:type", "website"),
    property("og:site_name", siteName),
    property("og:title", meta.title),
    property("og:description", meta.description),
    property("og:url", `${url.origin}${url.pathname}`),
    property("og:image", image),
    property("og:image:type", "image/png"),
    property("og:image:width", "1200"),
    property("og:image:height", "630"),
    property("og:image:alt", meta.imageAlt),
    named("twitter:card", "summary_large_image"),
    named("twitter:title", meta.title),
    named("twitter:description", meta.description),
    named("twitter:image", image),
    named("twitter:image:alt", meta.imageAlt),
  ].join("")
}
