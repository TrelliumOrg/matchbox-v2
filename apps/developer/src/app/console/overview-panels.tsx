import type { OrgReview } from "@matchbox/contracts/console"
import type { PlatformHealthResponse } from "@matchbox/contracts/platform-health"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { changelogDocsUrl } from "../lib/docs-links"

const statusNames = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "—",
} as const

const statusTones = {
  operational: "text-pos",
  degraded: "text-acc-ink",
  down: "text-neg",
  unknown: "text-mut",
} as const

const whole = new Intl.NumberFormat("en-US")

function ago(seconds: number | null): string {
  if (seconds === null) return "—"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

/** Classic: "api", or "api · v1.2.3" when the API reports a release. */
function apiLabel(version: string | null): string {
  if (version === null || version === "local") return "api"
  return `api · ${/^\d/.test(version) ? `v${version}` : version}`
}

/**
 * Classic's Overview status strip: the Gauge Profile API and Matchbox ID
 * from the health probes, and chain-sync freshness per network.
 */
export function PlatformStatus({
  health,
}: {
  health: PlatformHealthResponse | null
}): ReactNode {
  const product = (key: "gauge-profile-api" | "matchbox-id") =>
    health?.products.find((entry) => entry.product === key) ?? null
  const chain = (network: "mezo" | "mezo-testnet") =>
    health?.chainSync.find((entry) => entry.network === network) ?? null
  const local = health?.source === "local" ? " · local" : ""
  const api = product("gauge-profile-api")
  const id = product("matchbox-id")
  const items: { label: string; value: ReactNode; sub: string }[] = [
    {
      label: "Gauge Profile API",
      value: (
        <span className={statusTones[api?.status ?? "unknown"]}>
          {statusNames[api?.status ?? "unknown"]}
        </span>
      ),
      sub: `${apiLabel(api?.version ?? null)}${local}`,
    },
    {
      label: "Matchbox ID",
      value: (
        <span className={statusTones[id?.status ?? "unknown"]}>
          {statusNames[id?.status ?? "unknown"]}
        </span>
      ),
      sub: `id · OIDC${local}`,
    },
    ...(["mezo", "mezo-testnet"] as const).map((network) => {
      const sync = chain(network)
      return {
        label:
          network === "mezo" ? "Chain sync · Mezo" : "Chain sync · Testnet",
        value: (
          <span className={statusTones[sync?.status ?? "unknown"]}>
            {ago(sync?.lagSeconds ?? null)}
          </span>
        ),
        sub:
          sync?.blockNumber == null
            ? "block —"
            : `block ${whole.format(BigInt(sync.blockNumber))}`,
      }
    }),
  ]
  return (
    <section
      aria-label="Platform status"
      className="grid grid-cols-2 gap-5 rounded-[24px] bg-soft p-5 md:grid-cols-4"
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <p className="truncate text-[14px] text-sec">{item.label}</p>
          <p className="mt-1 text-[17px] font-semibold">
            {health === null ? (
              <span className="text-mut">Unavailable</span>
            ) : (
              item.value
            )}
          </p>
          <p className="truncate font-mono text-[13px] text-sec">{item.sub}</p>
        </div>
      ))}
    </section>
  )
}

const reviewNames = {
  open: "In review",
  approved: "Approved",
  "changes-requested": "Changes requested",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
} as const

const day = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

/** Classic's Overview reviews: the three latest, with the reviewer's note. */
export function RecentReviews({
  reviews,
}: {
  reviews: OrgReview[] | null
}): ReactNode {
  if (reviews === null) return null
  const rows = reviews
    .filter((review) => review.state !== "withdrawn")
    .slice(0, 3)
  return (
    <section aria-labelledby="reviews-title" className="mt-14">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 id="reviews-title" className="text-[22px] font-[650] text-ink">
          Reviews
        </h2>
        <a
          href={changelogDocsUrl}
          className="text-[15.5px] font-semibold text-ink underline underline-offset-[3px]"
        >
          Changelog
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="text-[15.5px] text-sec">No reviews</p>
      ) : (
        <ul>
          {rows.map((review) => (
            <li
              key={review.id}
              className="flex flex-col gap-1.5 border-t border-line py-3.5 first:border-t-0"
            >
              <p className="flex items-center gap-2">
                <Link
                  to="/apps/$appId"
                  params={{ appId: review.app.id }}
                  search={{ tab: "environment", env: review.environmentKind }}
                  className="truncate text-[16px] font-semibold text-ink hover:underline"
                >
                  {review.app.name}
                </Link>
                <span className="text-[14px] text-sec">
                  {review.environmentKind === "live" ? "Live" : "Test"}
                </span>
                <span className="flex-1" />
                <span className="text-[14.5px] font-medium text-ink2">
                  {reviewNames[review.state]}
                </span>
              </p>
              <p className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-sec">
                  {review.requestedScopes.join(" ")}
                </span>
                <span className="text-[14px] text-sec">
                  {review.state === "open"
                    ? `Submitted ${day.format(new Date(review.createdAt))}`
                    : review.decidedAt === null
                      ? ""
                      : day.format(new Date(review.decidedAt))}
                </span>
              </p>
              {review.reviewerNote === null ||
              review.state === "approved" ? null : (
                <p className="whitespace-pre-wrap rounded-[14px] bg-acc-soft px-3.5 py-2.5 text-[14.5px] text-ink">
                  {review.reviewerNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
