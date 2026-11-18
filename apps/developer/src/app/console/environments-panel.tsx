import type { DeveloperReview, Environment } from "@matchbox/contracts/console"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { Link, useRouter } from "@tanstack/react-router"
import { type ReactNode, useEffect, useId, useState } from "react"
import type { EnvironmentsExtras } from "../data/console-api"
import { errorMessage } from "../lib/api-error"
import { CopyField } from "./copy-field"
import { Glyph } from "./glyphs"
import { type ScopeName, scopeRows } from "./scope-rows"
import { StepUpCancelledError, useStepUp } from "./step-up"

const idScopes = new Set<string>([
  "openid",
  "wallet",
  "discord:id",
  "discord:profile",
  "discord:membership",
])

/**
 * `awaitingVerification` from @matchbox/contracts/console, kept here so the
 * page does not load zod: a live consent screen without staff verification.
 */
export function awaitingVerification(environment: Environment): boolean {
  return (
    environment.kind === "live" &&
    environment.verifiedAt === null &&
    environment.requestedScopes.some((scope) => idScopes.has(scope))
  )
}

const networkNames: Record<string, string> = {
  mezo: "Mezo, chain 31612",
  "mezo-testnet": "Mezo Testnet, chain 31611",
}

const whole = new Intl.NumberFormat("en-US")

const shortDay = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

const dayTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
})

const chipTones = {
  approved: "bg-pos-soft text-pos",
  review: "bg-soft2 text-ink2",
  changes: "bg-acc-soft text-acc-ink",
  rejected: "bg-neg-soft text-neg",
  none: "bg-soft text-sec",
} as const

function Chip({
  tone,
  children,
}: {
  tone: keyof typeof chipTones
  children: ReactNode
}): ReactNode {
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold ${chipTones[tone]}`}
    >
      {children}
    </span>
  )
}

/** Shared by the scopes table and the review: step-up, refresh, error. */
function useAction(): {
  pending: string | null
  error: string | null
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>
  sheet: ReactNode
} {
  const router = useRouter()
  const stepUp = useStepUp()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function run(
    key: string,
    action: () => Promise<unknown>,
  ): Promise<boolean> {
    setPending(key)
    setError(null)
    try {
      await stepUp.run(action)
      await router.invalidate()
      return true
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
      return false
    } finally {
      setPending(null)
    }
  }
  return { pending, error, run, sheet: stepUp.sheet }
}

function EnvironmentCard({
  environment,
  selected,
  requests,
}: {
  environment: Environment | undefined
  selected: boolean
  requests: number | null | undefined
}): ReactNode {
  if (environment === undefined) return null
  const live = environment.kind === "live"
  const approved = scopeRows.filter((row) =>
    environment.approvedScopes.includes(row.scope),
  )
  return (
    <article
      aria-label={live ? "Live" : "Test"}
      className="flex flex-col overflow-hidden rounded-[24px] bg-soft"
    >
      <div
        className={`flex h-[54px] items-center justify-between px-5 text-[15px] font-[650] ${selected ? "bg-ink text-bg" : "bg-soft2 text-ink"}`}
      >
        {live ? "Live" : "Test"}
        <span title={networkNames[environment.network] ?? environment.network}>
          <Icon
            name={live ? "globe" : "flask-conical"}
            size={17}
            strokeWidth={1.8}
          />
          <span className="sr-only">
            {networkNames[environment.network] ?? environment.network}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-3 p-5 text-[15.5px]">
        <CopyField label="client ID" value={environment.clientId} />
        <dl className="mt-1 flex flex-col gap-2">
          <div className="flex justify-between gap-4">
            <dt className="text-sec">Client type</dt>
            <dd className="text-ink">
              {environment.clientType === "public"
                ? "Public with PKCE"
                : "Confidential"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sec">Approved scopes</dt>
            <dd className="flex items-center gap-2 text-ink">
              {live
                ? approved.map((row) => (
                    <span
                      key={row.scope}
                      title={row.label}
                      className="text-sec"
                    >
                      <Glyph name={row.glyph} size={16} />
                    </span>
                  ))
                : null}
              {approved.length} of {scopeRows.length}
            </dd>
          </div>
          {live ? null : (
            <div>
              <dt className="text-sec">No review in Test</dt>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-sec">Requests, 7d</dt>
            <dd className="text-ink tabular-nums">
              {requests === null || requests === undefined
                ? "—"
                : whole.format(requests)}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  )
}

function ScopesTable({ environment }: { environment: Environment }): ReactNode {
  const action = useAction()
  const initialRequested = environment.requestedScopes as readonly string[]
  const initialOptional = (environment.optionalScopes ?? []) as string[]
  const [requested, setRequested] = useState(() => new Set(initialRequested))
  const [optional, setOptional] = useState(() => new Set(initialOptional))
  const locked = environment.openReview !== null
  const inReview = new Set<string>(environment.openReview?.requestedScopes)
  const approved = new Set<string>(environment.approvedScopes)
  useEffect(() => {
    setRequested(new Set(environment.requestedScopes))
    setOptional(new Set(environment.optionalScopes ?? []))
  }, [environment])
  const dirty =
    [...requested].sort().join(" ") !==
      [...initialRequested].sort().join(" ") ||
    [...optional]
      .filter((scope) => requested.has(scope))
      .sort()
      .join(" ") !== [...initialOptional].sort().join(" ")
  const otherIdScopes = [...requested].some(
    (scope) => scope !== "openid" && idScopes.has(scope),
  )

  function toggle(scope: ScopeName, on: boolean): void {
    const next = new Set(requested)
    if (on) {
      next.add(scope)
      if (idScopes.has(scope)) next.add("openid")
    } else {
      next.delete(scope)
    }
    setRequested(next)
  }

  function save(): void {
    void action.run("scopes", async () => {
      const { environments } = await import("../lib/api")
      const nextRequested = scopeRows
        .map((row) => row.scope)
        .filter((scope) => requested.has(scope))
      const nextOptional = scopeRows
        .filter(
          (row) =>
            row.optionalAllowed &&
            requested.has(row.scope) &&
            optional.has(row.scope),
        )
        .map((row) => row.scope)
      await environments.updateScopes(
        environment.id,
        nextRequested,
        nextOptional.filter((scope) => scope !== "gauge-profiles:read"),
      )
    })
  }

  return (
    <section aria-labelledby="scopes-title" className="mt-14">
      <h2 id="scopes-title" className="mb-4 text-[24px] font-[650] text-ink">
        {environment.kind === "live" ? "Live scopes" : "Test scopes"}
      </h2>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line text-[14px] text-sec">
            <th className="w-11 pb-3">
              <span className="sr-only">Requested</span>
            </th>
            <th className="pb-3 font-normal">Scope</th>
            <th className="pb-3 font-normal max-md:hidden">Claims</th>
            <th className="pb-3 font-normal">Optional</th>
            <th className="pb-3 text-right font-normal max-sm:hidden">State</th>
          </tr>
        </thead>
        <tbody>
          {scopeRows.map((row) => {
            const on = requested.has(row.scope)
            const checkboxId = `scope-${row.scope}`
            const state = approved.has(row.scope) ? (
              <Chip tone="approved">Approved</Chip>
            ) : inReview.has(row.scope) ? (
              <Chip tone="review">In review</Chip>
            ) : environment.kind === "test" && on ? (
              <Chip tone="approved">Test</Chip>
            ) : (
              <Chip tone="none">Not submitted</Chip>
            )
            return (
              <tr key={row.scope} className="border-b border-line">
                <td className="py-4">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={on}
                    disabled={
                      locked ||
                      action.pending !== null ||
                      (row.scope === "openid" && on && otherIdScopes)
                    }
                    onChange={(event) =>
                      toggle(row.scope, event.target.checked)
                    }
                    className="size-5 accent-[var(--color-acc)]"
                  />
                </td>
                <td className="py-4">
                  <label htmlFor={checkboxId} className="cursor-pointer">
                    <span className="block font-mono text-[15px] font-semibold text-ink">
                      {row.scope}
                    </span>
                    <span className="block text-[14.5px] text-sec">
                      {row.label}
                    </span>
                  </label>
                  {/* Phones: the state goes under the scope, not in a
                      fourth column that ran off a 360px screen. */}
                  <span className="mt-1.5 block sm:hidden">{state}</span>
                </td>
                <td className="py-4 font-mono text-[14px] text-ink2 max-md:hidden">
                  {row.claims.length === 0 ? (
                    <span className="font-sans text-[15px]">API only</span>
                  ) : (
                    row.claims.join(", ")
                  )}
                </td>
                <td className="py-4">
                  {row.optionalAllowed ? (
                    <input
                      type="checkbox"
                      role="switch"
                      aria-checked={on && optional.has(row.scope)}
                      aria-label={`${row.label} optional`}
                      checked={on && optional.has(row.scope)}
                      disabled={!on || locked || action.pending !== null}
                      onChange={(event) => {
                        const next = new Set(optional)
                        if (event.target.checked) next.add(row.scope)
                        else next.delete(row.scope)
                        setOptional(next)
                      }}
                      className="relative h-7 w-11 cursor-pointer appearance-none rounded-full bg-soft2 transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-6 before:rounded-full before:bg-raised before:shadow-lift before:transition-transform checked:bg-acc checked:before:translate-x-4 focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:before:transition-none"
                    />
                  ) : (
                    <span className="text-[15px] text-sec">Required</span>
                  )}
                </td>
                <td className="py-4 text-right max-sm:hidden">{state}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {locked ? (
        <p className="mt-4 text-[14.5px] text-sec">
          Review open · withdraw to edit scopes
        </p>
      ) : (
        <div className="mt-6 flex gap-3">
          <PillButton.Root
            disabled={!dirty}
            pending={action.pending === "scopes"}
            onClick={save}
          >
            Save scopes
          </PillButton.Root>
          <PillButton.Root
            intent="neutral"
            className="bg-soft"
            disabled={!dirty || action.pending !== null}
            onClick={() => {
              setRequested(new Set(initialRequested))
              setOptional(new Set(initialOptional))
            }}
          >
            Discard
          </PillButton.Root>
        </div>
      )}
      {action.error === null ? null : (
        <p role="alert" className="mt-3 text-[15px] font-medium text-neg">
          {action.error}
        </p>
      )}
      {action.sheet}
    </section>
  )
}

function historyEntries(reviews: DeveloperReview[]): {
  key: string
  title: string
  scopes: string
  by: string
  at: string
  icon: "send" | "note" | "check"
  chip: { tone: keyof typeof chipTones; label: string } | null
}[] {
  const entries = []
  for (const review of reviews) {
    const scopes = review.requestedScopes.join(", ")
    if (review.decidedAt !== null && review.state !== "open") {
      const decided = {
        approved: { tone: "approved", label: "Approved", title: "Approved" },
        "changes-requested": {
          tone: "changes",
          label: "Changes requested",
          title: "Reviewed",
        },
        rejected: { tone: "rejected", label: "Rejected", title: "Rejected" },
        withdrawn: { tone: "none", label: "Withdrawn", title: "Withdrew" },
      } as const
      const outcome = decided[review.state]
      entries.push({
        key: `${review.id}-decided`,
        title: outcome.title,
        scopes,
        by:
          review.decidedBy === "developer"
            ? (review.submitterName ?? "Developer")
            : review.decidedBy === "auto"
              ? "Automatic"
              : "Matchbox review",
        at: review.decidedAt,
        icon:
          review.state === "approved" ? ("check" as const) : ("note" as const),
        chip: { tone: outcome.tone, label: outcome.label },
      })
    }
    entries.push({
      key: `${review.id}-submitted`,
      title: "Submitted",
      scopes,
      by: review.submitterName ?? "Developer",
      at: review.createdAt,
      icon: "send" as const,
      chip:
        review.state === "open"
          ? { tone: "review" as const, label: "In review" }
          : null,
    })
  }
  return entries.slice(0, 8)
}

const historyIcons = {
  send: "arrow-up-right",
  note: "list",
  check: "check",
} as const

function Review({
  environment,
  reviews,
}: {
  environment: Environment
  reviews: DeveloperReview[] | null
}): ReactNode {
  const action = useAction()
  const noteId = useId()
  const [note, setNote] = useState("")
  const [noteClosed, setNoteClosed] = useState(false)
  const pending = environment.requestedScopes.filter(
    (scope) => !environment.approvedScopes.includes(scope),
  )
  const submittable =
    pending.length > 0 || !awaitingVerification(environment)
      ? pending
      : environment.requestedScopes
  const open = environment.openReview
  const latest = reviews?.[0]
  const reviewerNote =
    latest !== undefined &&
    latest.reviewerNote !== null &&
    (latest.state === "changes-requested" || latest.state === "rejected")
      ? latest
      : null
  const resubmit = reviewerNote !== null
  return (
    <section aria-labelledby="review-title" className="mt-14">
      <h2 id="review-title" className="mb-4 text-[24px] font-[650] text-ink">
        Review
      </h2>
      {open !== null ? (
        <div className="flex flex-wrap items-center gap-4 rounded-[24px] bg-soft p-5">
          <span className="grid size-12 flex-none place-items-center rounded-full bg-acc-soft text-acc-ink">
            <Icon name="clock" size={19} strokeWidth={1.8} />
          </span>
          <p className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold text-ink">
              <span className="font-mono">
                {open.requestedScopes.join(", ")}
              </span>{" "}
              for {environment.kind === "live" ? "Live" : "Test"}
            </span>
            <span className="block text-[15px] text-sec">
              Open since {shortDay.format(new Date(open.createdAt))}
            </span>
          </p>
          <Chip tone="review">In review</Chip>
          <PillButton.Root
            intent="neutral"
            className="bg-bg"
            pending={action.pending === "withdraw"}
            onClick={() =>
              void action.run("withdraw", async () => {
                const { environments } = await import("../lib/api")
                await environments.withdrawReview(environment.id)
              })
            }
          >
            Withdraw
          </PillButton.Root>
        </div>
      ) : submittable.length > 0 ? (
        <form
          className="flex flex-col gap-3 rounded-[24px] bg-soft p-5"
          onSubmit={(event) => {
            event.preventDefault()
            void action
              .run("submit", async () => {
                const { environments } = await import("../lib/api")
                await environments.submitReview(environment.id, note.trim())
              })
              .then((done) => {
                if (done) setNote("")
              })
          }}
        >
          <p className="font-mono text-[14.5px] text-ink">
            {submittable.join(", ")}
          </p>
          <label htmlFor={noteId} className="text-[15px] text-sec">
            Note for reviewers
          </label>
          <textarea
            id={noteId}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-24 rounded-[16px] border border-line bg-bg p-4 text-[15.5px] text-ink outline-none focus:border-acc"
          />
          <PillButton.Root
            type="submit"
            className="w-fit"
            pending={action.pending === "submit"}
          >
            {resubmit ? "Resubmit" : "Submit for review"}
          </PillButton.Root>
        </form>
      ) : (
        <p className="text-[15.5px] text-sec">Nothing to review</p>
      )}
      {reviewerNote === null || noteClosed ? null : (
        <aside className="mt-3 flex items-center gap-4 rounded-[24px] bg-soft p-5">
          <span className="grid size-11 flex-none place-items-center rounded-full bg-bg text-ink">
            <Icon name="list" size={17} strokeWidth={1.8} />
          </span>
          <p className="min-w-0 flex-1">
            <span className="block whitespace-pre-wrap text-[16px] text-ink">
              {reviewerNote.reviewerNote}{" "}
              <Link
                to="/apps/$appId"
                params={{ appId: environment.appId }}
                search={(current: { org?: string }) => ({
                  ...(current.org === undefined ? {} : { org: current.org }),
                  tab: "settings" as const,
                  env: environment.kind,
                })}
                className="font-semibold underline underline-offset-[3px]"
              >
                Open settings
              </Link>
            </span>
            {reviewerNote.decidedAt === null ? null : (
              <span className="block text-[14.5px] text-sec">
                {shortDay.format(new Date(reviewerNote.decidedAt))}
              </span>
            )}
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNoteClosed(true)}
            className="grid size-9 flex-none cursor-pointer place-items-center rounded-full text-sec hover:bg-bg"
          >
            <Icon name="x" size={16} strokeWidth={2} />
          </button>
        </aside>
      )}
      {action.error === null ? null : (
        <p role="alert" className="mt-3 text-[15px] font-medium text-neg">
          {action.error}
        </p>
      )}
      {reviews === null || reviews.length === 0 ? null : (
        <div className="mt-8">
          <h3 className="mb-2 text-[16px] font-normal text-sec">History</h3>
          <ol>
            {historyEntries(reviews).map((entry) => (
              <li key={entry.key} className="flex items-center gap-4 py-3">
                <span className="grid size-10 flex-none place-items-center rounded-full bg-soft text-ink">
                  <Icon
                    name={historyIcons[entry.icon]}
                    size={16}
                    strokeWidth={1.8}
                  />
                </span>
                <p className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold text-ink">
                    {entry.title}{" "}
                    <span className="font-mono">{entry.scopes}</span>
                  </span>
                  <span className="block text-[15px] text-sec">
                    {entry.by}, {dayTime.format(new Date(entry.at))}
                  </span>
                </p>
                {entry.chip === null ? null : (
                  <Chip tone={entry.chip.tone}>{entry.chip.label}</Chip>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {action.sheet}
    </section>
  )
}

/**
 * Environments (`45HRaWcjCi`): both environments side by side, then the
 * selected one's scopes (saved together, as Classic's environments page
 * did) and its review with the reviewer's note and history.
 */
export function EnvironmentsPanel({
  extras,
  environments,
  selected,
}: {
  extras: EnvironmentsExtras | null
  environments: Environment[]
  selected: Environment
}): ReactNode {
  const test = environments.find((environment) => environment.kind === "test")
  const live = environments.find((environment) => environment.kind === "live")
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EnvironmentCard
          environment={test}
          selected={selected.kind === "test"}
          requests={test === undefined ? null : extras?.requests?.[test.id]}
        />
        <EnvironmentCard
          environment={live}
          selected={selected.kind === "live"}
          requests={live === undefined ? null : extras?.requests?.[live.id]}
        />
      </div>
      <ScopesTable environment={selected} />
      {selected.kind === "live" ? (
        <Review
          environment={selected}
          reviews={extras === null ? null : (extras.reviews[selected.id] ?? [])}
        />
      ) : null}
    </>
  )
}
