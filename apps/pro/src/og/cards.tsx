import { shapes } from "@matchbox/ui/icons"
import type { CSSProperties, ReactNode } from "react"
import { hueOf } from "../data/adapters"
import { kindShape } from "../features/gauge/kind-icon"
import {
  formatApy,
  formatCompactVotes,
  formatDecimal,
  formatDuration,
  formatSignedUsd,
  formatUsd,
} from "../lib/format"
import { coinUri, glyphUri, lockupImage } from "./assets"
import type {
  Card,
  CardPicture,
  DefaultCard,
  GaugeCard,
  ProtocolCard,
} from "./model"
import {
  acc,
  avatarColors,
  bandAcc,
  bandPos,
  bg,
  ink,
  line,
  mezo,
  mut,
  pos,
  sec,
  soft2,
} from "./palette"

/**
 * The three 1200x630 link preview cards (Doop `6Mtre5WwuA`) as Satori
 * element trees: Graphite ground, a 10px Matchbox pink stripe, the
 * MATCHBOX PRO lockup. Satori lays out with flexbox only, so every box
 * with more than one child is `display: flex`.
 */

/** Figtree 650, the house figure weight, registered with Satori as 600. */
const semibold = 600

export const cardWidth = 1200
export const cardHeight = 630

/** Pictures the renderer already fetched, as data URIs. */
export type CardAssets = {
  /** Shown in the footer and the Protocol header ("pro.matchbox.markets"). */
  host: string
  picture: string | null
}

const label: CSSProperties = { fontSize: 24, color: sec, fontWeight: 400 }
const figure: CSSProperties = {
  fontSize: 64,
  fontWeight: semibold,
  letterSpacing: "-0.025em",
  lineHeight: 1,
  color: ink,
}

function Frame({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      style={{
        width: cardWidth,
        height: cardHeight,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        padding: "64px 72px",
        backgroundColor: bg,
        color: ink,
        fontFamily: "Figtree",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 10,
          backgroundColor: mezo,
        }}
      />
      {children}
    </div>
  )
}

function Top({ right }: { right: ReactNode }): ReactNode {
  const lockup = lockupImage()
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <img
        src={lockup.uri}
        width={lockup.width}
        height={lockup.height}
        alt="Matchbox Pro"
      />
      {right}
    </div>
  )
}

function Epoch({
  epoch,
  endsIn,
}: {
  epoch: number
  endsIn: number | null
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        fontSize: 24,
        fontWeight: semibold,
        color: sec,
      }}
    >
      <img src={glyphUri(shapes.clock, sec)} width={24} height={24} alt="" />
      <span style={{ marginLeft: 10, color: ink }}>{`Epoch ${epoch}`}</span>
      {endsIn === null ? null : (
        <span style={{ marginLeft: 12 }}>{formatDuration(endsIn)}</span>
      )}
    </div>
  )
}

function Url({ text }: { text: string }): ReactNode {
  return (
    <span style={{ fontFamily: "DM Mono", fontSize: 22, color: mut }}>
      {text}
    </span>
  )
}

/** A coin, or the ticker's first letter on a disc for tokens without one. */
function Coin({
  ticker,
  size,
  ring,
}: {
  ticker: string
  size: number
  ring?: string
}): ReactNode {
  const uri = coinUri(ticker)
  const border: CSSProperties =
    ring === undefined ? {} : { border: `3px solid ${ring}` }
  if (uri === null) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: soft2,
          color: ink,
          fontSize: Math.round(size * 0.45),
          fontWeight: semibold,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...border,
        }}
      >
        {ticker.slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: size,
        ...border,
      }}
    >
      <img
        src={uri}
        width={ring === undefined ? size : size - 6}
        height={ring === undefined ? size : size - 6}
        alt={ticker}
      />
    </div>
  )
}

/** Up to three coins, overlapping, each ringed in the ground colour. */
function Coins({
  tickers,
  size,
}: {
  tickers: readonly string[]
  size: number
}): ReactNode {
  const shown = tickers.slice(0, 3)
  if (shown.length === 1) {
    return <Coin ticker={shown[0] ?? ""} size={size} />
  }
  return (
    <div style={{ display: "flex" }}>
      {shown.map((ticker, index) => (
        <div
          key={ticker}
          style={{
            display: "flex",
            marginLeft: index === 0 ? 0 : -Math.round(size * 0.35),
          }}
        >
          <Coin ticker={ticker} size={size + 6} ring={bg} />
        </div>
      ))}
    </div>
  )
}

function Stat({ value, unit }: { value: string; unit: string }): ReactNode {
  return (
    <div style={{ display: "flex", alignItems: "center", ...label }}>
      <span style={{ color: ink, fontWeight: semibold }}>{value}</span>
      <span style={{ marginLeft: 8 }}>{unit}</span>
    </div>
  )
}

function DefaultLayout({
  card,
  host,
}: {
  card: DefaultCard
  host: string
}): ReactNode {
  return (
    <Frame>
      <Top
        right={
          // Without live figures (the API failed) the card is the brand card.
          card.incentivesUsd === null && card.endsIn === null ? null : (
            <Epoch epoch={card.epoch} endsIn={card.endsIn} />
          )
        }
      />
      <div
        style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}
      >
        <span style={label}>
          {card.incentivesUsd === null ? "Mezo Earn" : "Incentives this epoch"}
        </span>
        <span
          style={{
            ...figure,
            fontSize: card.incentivesUsd === null ? 104 : 128,
            marginTop: 10,
          }}
        >
          {card.incentivesUsd === null
            ? "Vote, claim, lock"
            : formatUsd(card.incentivesUsd, "cents")}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: 44,
          paddingTop: 28,
          borderTop: `2px solid ${line}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {card.veMezoLocked === null ? null : (
            <div style={{ display: "flex", alignItems: "center" }}>
              <Coin ticker="MEZO" size={28} />
              <div style={{ display: "flex", marginLeft: 10 }}>
                <Stat
                  value={formatCompactVotes(card.veMezoLocked)}
                  unit="veMEZO locked"
                />
              </div>
            </div>
          )}
          {card.veBtcLocked === null ? null : (
            <div
              style={{ display: "flex", alignItems: "center", marginLeft: 56 }}
            >
              <Coin ticker="BTC" size={28} />
              <div style={{ display: "flex", marginLeft: 10 }}>
                <Stat
                  value={formatDecimal(card.veBtcLocked, 2)}
                  unit="veBTC locked"
                />
              </div>
            </div>
          )}
        </div>
        <Url text={host} />
      </div>
    </Frame>
  )
}

function Picture({
  picture,
  uri,
  size,
}: {
  picture: CardPicture
  uri: string | null
  size: number
}): ReactNode {
  if (picture.kind === "image" && uri !== null) {
    return (
      <div
        style={{
          display: "flex",
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.27),
          overflow: "hidden",
          backgroundColor: "#ffffff",
        }}
      >
        <img
          src={uri}
          width={size}
          height={size}
          style={{ objectFit: "cover" }}
          alt=""
        />
      </div>
    )
  }
  if (picture.kind === "pair") {
    const coin = Math.round(size * 0.68)
    const [lead = "", second] = picture.tokens
    return (
      <div style={{ display: "flex", width: size, height: size }}>
        <div style={{ display: "flex", position: "absolute", left: 0, top: 0 }}>
          <Coin ticker={lead} size={coin} />
        </div>
        {second === undefined ? null : (
          <div
            style={{
              display: "flex",
              position: "absolute",
              right: -4,
              bottom: -4,
            }}
          >
            <Coin ticker={second} size={coin + 8} ring={bg} />
          </div>
        )}
      </div>
    )
  }
  const { initials, hue } =
    picture.kind === "initials" ? picture : { initials: "", hue: 0 }
  const colors = avatarColors(hue)
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: colors.fill,
        color: colors.text,
        fontSize: Math.round(size * 0.32),
        fontWeight: semibold,
      }}
    >
      {initials}
    </div>
  )
}

/** Long names step down so they stay on one line. */
function nameSize(name: string): number {
  if (name.length <= 14) return 76
  if (name.length <= 20) return 64
  if (name.length <= 26) return 52
  return 44
}

function GaugeLayout({
  card,
  assets,
}: {
  card: GaugeCard
  assets: CardAssets
}): ReactNode {
  const size = nameSize(card.name)
  // A picture that did not load shows the name's initials.
  const picture: CardPicture =
    card.picture.kind === "image" && assets.picture === null
      ? {
          kind: "initials",
          initials: card.name.slice(0, 2).toUpperCase(),
          hue: hueOf(card.address),
        }
      : card.picture
  return (
    <Frame>
      <Top right={<Epoch epoch={card.epoch} endsIn={null} />} />
      <div style={{ display: "flex", alignItems: "center", marginTop: "auto" }}>
        <Picture picture={picture} uri={assets.picture} size={132} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: 32,
            maxWidth: 860,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span
              style={{
                ...figure,
                fontSize: size,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: card.id === null ? 860 : 680,
              }}
            >
              {card.name}
            </span>
            {card.id === null ? null : (
              <span
                style={{
                  marginLeft: 16,
                  fontSize: Math.round(size * 0.63),
                  fontWeight: 500,
                  color: mut,
                }}
              >
                {card.id}
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: 12,
              ...label,
            }}
          >
            <img
              src={glyphUri(kindShape[card.gaugeKind], sec)}
              width={26}
              height={26}
              alt=""
            />
            <span style={{ marginLeft: 10 }}>{card.typeLine}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 48 }}>
        {card.apyBps === null ? null : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginRight: 72,
            }}
          >
            <span style={label}>APY</span>
            <span style={{ ...figure, marginTop: 8 }}>
              {formatApy(card.apyBps)}
            </span>
          </div>
        )}
        <div
          style={{ display: "flex", flexDirection: "column", marginRight: 72 }}
        >
          <span style={label}>Incentives</span>
          <div style={{ display: "flex", alignItems: "center", marginTop: 8 }}>
            {card.incentiveTokens.length === 0 ? null : (
              <div style={{ display: "flex", marginRight: 14 }}>
                <Coins tickers={card.incentiveTokens} size={44} />
              </div>
            )}
            <span style={figure}>{formatUsd(card.incentivesUsd, "cents")}</span>
          </div>
        </div>
        {card.boost === null ? null : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={label}>Boost</span>
            <span
              style={{
                ...figure,
                marginTop: 8,
                color: card.boost.atMax ? pos : ink,
              }}
            >
              {card.boost.label}
            </span>
          </div>
        )}
      </div>
      {card.band === null ? null : (
        <div
          style={{
            display: "flex",
            marginTop: 40,
            height: 16,
            borderRadius: 8,
            overflow: "hidden",
            backgroundColor: soft2,
          }}
        >
          <div
            style={{
              display: "flex",
              height: 16,
              width: `${Math.round(card.band.fill * 1000) / 10}%`,
              // Green and full at or past optimal, never red (owner, 9 Nov).
              backgroundColor: card.band.atMax ? bandPos : bandAcc,
            }}
          />
        </div>
      )}
    </Frame>
  )
}

const barsHeight = 240
const barTop = 220

function ProtocolLayout({
  card,
  host,
}: {
  card: ProtocolCard
  host: string
}): ReactNode {
  const values = card.bars.map((bar) => Number(bar.usd))
  const max = Math.max(...values, 0)
  const rising = !card.changeUsd.startsWith("-")
  return (
    <Frame>
      <Top right={<Url text={`${host}/protocol/${card.epoch}`} />} />
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: "auto",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={label}>{`Epoch ${card.epoch} incentives`}</span>
          <span style={{ ...figure, fontSize: 104, marginTop: 8 }}>
            {formatUsd(card.incentivesUsd, "cents")}
          </span>
          <div style={{ display: "flex", marginTop: 14, ...label }}>
            <span style={{ color: rising ? pos : ink, fontWeight: semibold }}>
              {formatSignedUsd(card.changeUsd, "cents")}
            </span>
            <span
              style={{ marginLeft: 8 }}
            >{`vs Epoch ${card.epoch - 1}`}</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            height: barsHeight,
          }}
        >
          {card.bars.map((bar, index) => (
            <div
              key={bar.epoch}
              style={{
                width: 30,
                marginLeft: index === 0 ? 0 : 10,
                borderRadius: 6,
                height:
                  max > 0
                    ? Math.max(6, Math.round((Number(bar.usd) / max) * barTop))
                    : 6,
                backgroundColor: bar.selected ? acc : soft2,
              }}
            />
          ))}
        </div>
      </div>
    </Frame>
  )
}

/** A card's element tree for Satori. */
export function cardElement(card: Card, assets: CardAssets): ReactNode {
  switch (card.kind) {
    case "default":
      return <DefaultLayout card={card} host={assets.host} />
    case "gauge":
      return <GaugeLayout card={card} assets={assets} />
    case "protocol":
      return <ProtocolLayout card={card} host={assets.host} />
  }
}
