import type { ReactNode } from "react"
import type { GaugeKind, VoteBranch, VoteUnit } from "./contract"

/**
 * Gauge types are first class (matchbox-v3, Decided 9 Nov 2026): every gauge
 * shows its type as an icon with a tooltip. Lucide (ISC) lock, globe,
 * server and droplets, 16px, stroke 1.75, secondary colour.
 */

const shapes: Record<GaugeKind, readonly string[]> = {
  vebtc: ["M7 11V7a5 5 0 0 1 10 0v4", "M5 11h14v10H5z"],
  mezo: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    "M3 12h18",
    "M12 3a14 14 0 0 1 0 18",
    "M12 3a14 14 0 0 0 0 18",
  ],
  validator: [
    "M5 3h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M5 13h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z",
    "M7 7h.01",
    "M7 17h.01",
  ],
  pool: [
    "M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z",
    "M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97",
  ],
}

export const kindLabel: Record<GaugeKind, string> = {
  vebtc: "veBTC gauge",
  mezo: "MEZO gauge",
  validator: "Validator gauge",
  pool: "Pool gauge",
}

/** A ranking row without `kind` (older payloads): from its voting branch. */
export function kindForBranch(branch: VoteBranch): GaugeKind {
  if (branch === "validators") return "validator"
  if (branch === "pools") return "pool"
  return "vebtc"
}

/** veMEZO votes veBTC and MEZO gauges; veBTC votes validators and pools. */
export function unitForKind(kind: GaugeKind): VoteUnit {
  return kind === "vebtc" || kind === "mezo" ? "veMEZO" : "veBTC"
}

export function KindIcon({
  kind,
  size = 16,
}: {
  kind: GaugeKind
  size?: number
}): ReactNode {
  const label = kindLabel[kind]
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      focusable="false"
      className="stuart-kind"
    >
      <title>{label}</title>
      {shapes[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
