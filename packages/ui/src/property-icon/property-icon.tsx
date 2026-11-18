import type { ComponentProps, ReactNode } from "react"
import { Tip } from "../floating/floating"
import { Glyph, type GlyphShape, type IconName, shapes } from "../icons"

/**
 * Properties are icons, not prose: scopes, networks, gauge type, created
 * dates and block time show as a 16 to 18px Lucide shape, stroke 1.75, in
 * the secondary colour, with a tooltip and an accessible name.
 */

export type PropertyName =
  | "sign-in-id"
  | "wallet"
  | "discord"
  | "gauge-data"
  | "mainnet"
  | "testnet"
  | "pool-gauge"
  | "vebtc-gauge"
  | "validator-gauge"
  | "mezo-gauge"
  | "created"
  | "block-time"
  | "epoch"

export const propertyIcons: Record<
  PropertyName,
  { icon: IconName; shape: GlyphShape; label: string }
> = {
  "sign-in-id": {
    icon: "key-round",
    shape: shapes.keyRound,
    label: "Sign-in ID",
  },
  wallet: {
    icon: "wallet",
    shape: shapes.wallet,
    label: "Wallet",
  },
  discord: {
    icon: "discord",
    shape: shapes.discord,
    label: "Discord",
  },
  "gauge-data": {
    icon: "chart-no-axes-combined",
    shape: shapes.chartNoAxesCombined,
    label: "Gauge data",
  },
  mainnet: {
    icon: "globe",
    shape: shapes.globe,
    label: "Mezo mainnet",
  },
  testnet: {
    icon: "flask-conical",
    shape: shapes.flaskConical,
    label: "Mezo Testnet",
  },
  "pool-gauge": {
    icon: "droplets",
    shape: shapes.droplets,
    label: "Pool gauge",
  },
  "vebtc-gauge": {
    icon: "lock",
    shape: shapes.lock,
    label: "veBTC gauge",
  },
  "validator-gauge": {
    icon: "server",
    shape: shapes.server,
    label: "Validator gauge",
  },
  "mezo-gauge": {
    icon: "globe",
    shape: shapes.globe,
    label: "MEZO gauge",
  },
  created: {
    icon: "calendar-days",
    shape: shapes.calendarDays,
    label: "Created",
  },
  "block-time": {
    icon: "timer",
    shape: shapes.timer,
    label: "Block time",
  },
  epoch: {
    icon: "clock",
    shape: shapes.clock,
    label: "Epoch",
  },
}

export type RootProps = {
  name: PropertyName
  /** Tooltip and accessible name. Defaults per icon ("Mezo mainnet"). */
  label?: string
  size?: 16 | 18
}

export function Root({ name, label, size = 18 }: RootProps): ReactNode {
  const property = propertyIcons[name]
  const text = label ?? property.label
  return (
    <Tip
      content={text}
      trigger={(tip) => (
        <span
          role="img"
          aria-label={text}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need the tooltip
          tabIndex={0}
          className="inline-grid flex-none cursor-default place-items-center rounded-sm text-sec outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          {...tip}
        >
          <Glyph shape={property.shape} size={size} strokeWidth={1.75} />
        </span>
      )}
    />
  )
}

Root.displayName = "PropertyIcon"

export function Group({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return (
    <div
      className={`inline-flex items-center gap-2 ${className ?? ""}`}
      {...props}
    />
  )
}

Group.displayName = "PropertyIcon.Group"

/** The thin divider between scopes and the network. */
export function Divider(): ReactNode {
  return <span aria-hidden="true" className="h-4 w-px flex-none bg-line" />
}

Divider.displayName = "PropertyIcon.Divider"
