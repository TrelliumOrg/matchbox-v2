import type { ApiKeyRecord } from "@matchbox/contracts/console"
import type { EnvironmentQuotaStatus } from "@matchbox/contracts/rate-limits"
import { BarChart } from "@matchbox/ui/chart"
import { type ReactNode, useState } from "react"
import type { UsageTab } from "../data/console-api"
import type { RequestLogEntry } from "../data/reads.server"
import {
  compactNumber,
  dayLabel,
  formatLatency,
  formatRate,
} from "../lib/numbers"

const time = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
})

const whole = new Intl.NumberFormat("en-US")

/** `/api/environments/{id}/usage.csv` for the same range, as Classic linked it. */
export function usageCsvHref(
  environmentId: string,
  from: string,
  to: string,
): string {
  const query = new URLSearchParams({ from, to, bucket: "day" })
  return `/api/environments/${encodeURIComponent(environmentId)}/usage.csv?${query}`
}

export type LogFilter = "all" | "client-error" | "rate-limited" | "server-error"

const filters: { value: LogFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "client-error", label: "4xx" },
  { value: "rate-limited", label: "429" },
  { value: "server-error", label: "5xx" },
]

/** Classic's log filters: 429 has its own chip, so 4xx leaves it out. */
export function matchesFilter(
  entry: Pick<RequestLogEntry, "status">,
  filter: LogFilter,
): boolean {
  if (filter === "all") return true
  if (filter === "rate-limited") return entry.status === 429
  if (filter === "server-error") return entry.status >= 500
  return entry.status >= 400 && entry.status < 500 && entry.status !== 429
}

function Detail({
  entry,
  keyName,
}: {
  entry: RequestLogEntry
  keyName: string | null
}): ReactNode {
  const rows: [string, string][] = [
    ["Request ID", entry.requestId],
    ["Time", `${time.format(new Date(entry.timestamp))} UTC`],
    ["Key", keyName ?? (entry.apiKeyId === null ? "None" : entry.apiKeyId)],
    ["Error", entry.errorCode ?? "None"],
    ["Cache", entry.cacheStatus ?? "—"],
    ["Edge", [entry.colo, entry.country].filter(Boolean).join(", ") || "—"],
    ["Latency", `${Math.round(entry.latencyMs)} ms`],
  ]
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-[16px] bg-soft p-4 text-[14px] sm:grid-cols-[120px_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-sec">{term}</dt>
          <dd className="font-mono text-[13px] break-all text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function QuotaPanel({ quota }: { quota: EnvironmentQuotaStatus }): ReactNode {
  const daily = quota.secret?.daily ?? null
  const burst = quota.secret?.burst ?? null
  const share =
    daily === null ? 0 : Math.min(100, (daily.used / daily.limit) * 100)
  return (
    <section
      aria-labelledby="quota-title"
      className="rounded-[24px] bg-soft p-5"
    >
      <h3 id="quota-title" className="text-[16px] font-semibold text-ink">
        Quota today
      </h3>
      {daily === null ? (
        <p className="mt-2 text-[15px] text-sec">No secret-key quota</p>
      ) : (
        <>
          <p className="mt-2 flex justify-between text-[14.5px] text-sec tabular-nums">
            <span>
              <span className="font-semibold text-ink">
                {whole.format(daily.used)}
              </span>{" "}
              of {whole.format(daily.limit)}
            </span>
            <span>{Math.round(share)}%</span>
          </p>
          <span className="mt-2 block h-1.5 rounded-full bg-soft2">
            <span
              className="block h-full rounded-full bg-acc"
              style={{ width: `${share}%` }}
            />
          </span>
        </>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[14px]">
        <div>
          <dt className="text-sec">Per minute</dt>
          <dd className="font-semibold text-ink tabular-nums">
            {burst === null
              ? "—"
              : `${whole.format(burst.used)} of ${whole.format(burst.limit)}`}
          </dd>
        </div>
        <div>
          <dt className="text-sec">Rate limited today</dt>
          <dd className="font-semibold text-ink tabular-nums">
            {quota.rateLimitedToday === null
              ? "—"
              : whole.format(quota.rateLimitedToday)}
          </dd>
        </div>
        {quota.override === null ? null : (
          <div className="col-span-2">
            <dt className="text-sec">Override</dt>
            <dd className="font-semibold text-ink tabular-nums">
              {whole.format(quota.override.perMinute)}/min,{" "}
              {whole.format(quota.override.perDay)}/day
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/**
 * An app's Usage tab for one environment (`6KF4QVLIpP`, Classic's per-app
 * usage): requests and errors per day, the quota today, the request log
 * with Classic's status filters and each request's detail, the busiest
 * routes and requests by key, and the CSV export.
 */
export function RequestLog({
  environmentId,
  data,
  apiKeys,
}: {
  environmentId: string
  data: UsageTab
  apiKeys: ApiKeyRecord[]
}): ReactNode {
  const [filter, setFilter] = useState<LogFilter>("all")
  const [open, setOpen] = useState<string | null>(null)
  const { usage, quota, log } = data
  const keyNames = new Map(
    apiKeys.map((key) => [key.id, `${key.name} (${key.displayPrefix})`]),
  )
  if (usage === null && log === null) {
    return <p className="text-[15.5px] text-sec">Usage unavailable</p>
  }
  const rows = log?.data.filter((entry) => matchesFilter(entry, filter)) ?? []
  return (
    <div className="flex flex-col gap-12">
      {usage === null ? null : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section
            aria-labelledby="usage-title"
            className="flex flex-col gap-5"
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2
                  id="usage-title"
                  className="text-[15px] font-normal text-sec"
                >
                  Requests, 7d
                </h2>
                <p className="text-[40px] font-[650] tracking-[-0.03em] text-ink tabular-nums">
                  {compactNumber(usage.totals.requests)}
                </p>
              </div>
              <dl className="flex gap-8">
                {[
                  ["Errors", compactNumber(usage.totals.errors)],
                  ["Error rate", formatRate(usage.totals.errorRate)],
                  ["p95", formatLatency(usage.totals.p95LatencyMs)],
                ].map(([term, value]) => (
                  <div key={term}>
                    <dt className="text-[14px] text-sec">{term}</dt>
                    <dd className="text-[17px] font-semibold text-ink tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            {usage.series.length === 0 ? null : (
              <>
                <BarChart
                  id={`env-requests-${environmentId}`}
                  label="Requests by day"
                  height={140}
                  bars={usage.series.map((point) => ({
                    label: dayLabel(point.start),
                    value: point.requests,
                    text: `${whole.format(point.requests)} requests`,
                  }))}
                />
                <BarChart
                  id={`env-errors-${environmentId}`}
                  label="Errors by day"
                  height={90}
                  selected={-1}
                  bars={usage.series.map((point) => ({
                    label: dayLabel(point.start),
                    value: point.errors,
                    text: `${whole.format(point.errors)} errors`,
                  }))}
                />
              </>
            )}
          </section>
          {quota === null ? null : <QuotaPanel quota={quota} />}
        </div>
      )}

      {log === null ? null : (
        <section
          aria-labelledby="requests-title"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="requests-title" className="text-[22px] font-[650] text-ink">
              Requests{" "}
              <span className="text-[15.5px] font-normal text-sec">7d</span>
            </h2>
            <span className="flex flex-wrap items-center gap-3">
              <span
                role="radiogroup"
                aria-label="Status"
                className="flex gap-1"
              >
                {filters.map((entry) => (
                  // biome-ignore lint/a11y/useSemanticElements: pill radio group
                  <button
                    key={entry.value}
                    type="button"
                    role="radio"
                    aria-checked={filter === entry.value}
                    onClick={() => setFilter(entry.value)}
                    className="h-9 cursor-pointer rounded-full px-3.5 text-[14.5px] font-semibold text-sec outline-none focus-visible:outline-2 focus-visible:outline-ink aria-checked:bg-ink aria-checked:text-bg"
                  >
                    {entry.label}
                  </button>
                ))}
              </span>
              <a
                href={usageCsvHref(environmentId, log.from, log.to)}
                className="text-[15px] font-semibold text-ink underline underline-offset-[3px]"
              >
                Export CSV
              </a>
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="text-[15.5px] text-sec">No requests</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((entry) => (
                <li key={entry.requestId} className="border-t border-line">
                  <button
                    type="button"
                    aria-expanded={open === entry.requestId}
                    onClick={() =>
                      setOpen((current) =>
                        current === entry.requestId ? null : entry.requestId,
                      )
                    }
                    className="flex w-full cursor-pointer items-center gap-4 py-3 text-left text-[14.5px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <span className="w-36 flex-none text-sec max-sm:hidden">
                      {time.format(new Date(entry.timestamp))}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-ink">
                      {entry.method} {entry.route}
                    </span>
                    <span
                      className={`w-12 text-right font-semibold tabular-nums ${entry.status >= 500 ? "text-neg" : entry.status >= 400 ? "text-acc-ink" : "text-ink"}`}
                    >
                      {entry.status}
                    </span>
                    <span className="w-16 text-right text-sec tabular-nums max-sm:hidden">
                      {Math.round(entry.latencyMs)} ms
                    </span>
                  </button>
                  {open === entry.requestId ? (
                    <div className="pb-4">
                      <Detail
                        entry={entry}
                        keyName={
                          entry.apiKeyId === null
                            ? null
                            : (keyNames.get(entry.apiKeyId) ?? null)
                        }
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {usage === null ? null : (
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <section aria-labelledby="routes-title">
            <h2
              id="routes-title"
              className="mb-3 text-[18px] font-[650] text-ink"
            >
              Top routes
            </h2>
            {usage.topRoutes.length === 0 ? (
              <p className="text-[15px] text-sec">No traffic</p>
            ) : (
              <ul>
                {usage.topRoutes.map((route) => (
                  <li
                    key={`${route.method} ${route.route}`}
                    className="flex items-center gap-3 border-t border-line py-2.5 text-[14.5px]"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-ink">
                      {route.method} {route.route}
                    </span>
                    <span className="text-sec tabular-nums">
                      {formatRate(
                        route.requests === 0
                          ? null
                          : route.errors / route.requests,
                      )}
                    </span>
                    <span className="w-14 text-right font-semibold text-ink tabular-nums">
                      {compactNumber(route.requests)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="keys-title">
            <h2
              id="keys-title"
              className="mb-3 text-[18px] font-[650] text-ink"
            >
              By key
            </h2>
            {usage.byKey.length === 0 ? (
              <p className="text-[15px] text-sec">No traffic</p>
            ) : (
              <ul>
                {usage.byKey.map((entry) => (
                  <li
                    key={entry.apiKeyId ?? "none"}
                    className="flex items-center gap-3 border-t border-line py-2.5 text-[14.5px]"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-ink">
                      {entry.apiKeyId === null
                        ? "No key"
                        : (keyNames.get(entry.apiKeyId) ??
                          entry.displayPrefix ??
                          entry.apiKeyId)}
                    </span>
                    <span className="text-sec tabular-nums">
                      {compactNumber(entry.errors)} errors
                    </span>
                    <span className="w-14 text-right font-semibold text-ink tabular-nums">
                      {compactNumber(entry.requests)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
