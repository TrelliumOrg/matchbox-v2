import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import { AppMark } from "../../app/console/app-row"
import { CopyField } from "../../app/console/copy-field"
import { scopeRows } from "../../app/console/scope-rows"
import { StepUpCancelledError, useStepUp } from "../../app/console/step-up"
import { getAdminReview } from "../../app/data/console-api"
import { errorMessage } from "../../app/lib/api-error"

type Decision = "approve" | "request-changes" | "reject"

const decisionNames: Record<Decision, string> = {
  approve: "Approve",
  "request-changes": "Request changes",
  reject: "Reject",
}

const stateNames = {
  open: "In review",
  approved: "Approved",
  "changes-requested": "Changes requested",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
} as const

const submittedAt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
})

const whole = new Intl.NumberFormat("en-US")

function bare(url: string): string {
  return url.replace(/^https:\/\//, "").replace(/\/$/, "")
}

/**
 * A review (`G8WW53OT44`): the app's consent profile, the scopes with the
 * wording people will see, the submitter's note, and the decision. Staff
 * see the logo as it was pinned at submission, never the developer's live
 * URL, and an approval names that logo's sha256 (the 29 Oct audit fix): if
 * the pinned logo changed since the page loaded the server answers 409 and
 * nothing is approved.
 */
export const Route = createFileRoute("/_console/admin/reviews/$reviewId")({
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    if (parent.loaderData?.me.staffRole == null) throw notFound()
    return getAdminReview({ data: { reviewId: params.reviewId } })
  },
  staleTime: 0,
  component: ReviewPage,
})

function ReviewPage(): ReactNode {
  const { review, logo, context } = Route.useLoaderData()
  const router = useRouter()
  const stepUp = useStepUp()
  const noteId = useId()
  const [note, setNote] = useState("")
  const [decision, setDecision] = useState<Decision>("approve")
  const [approved, setApproved] = useState(
    () => new Set<string>(review.requestedScopes),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = review.state === "open"
  const before = new Set<string>(review.environment.approvedScopes)
  const rows = scopeRows.filter((row) =>
    review.requestedScopes.includes(row.scope),
  )

  async function decide(): Promise<void> {
    setPending(true)
    setError(null)
    try {
      const { admin } = await import("../../app/lib/api")
      await stepUp.run(() =>
        admin.decide(review.id, {
          decision,
          ...(note.trim() === "" ? {} : { note: note.trim() }),
          ...(decision === "approve"
            ? {
                approvedScopes: review.requestedScopes.filter((scope) =>
                  approved.has(scope),
                ),
                logoSha256: logo.logo?.sha256 ?? null,
              }
            : {}),
        }),
      )
      await router.invalidate()
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  const links = [
    ["Website", review.app.websiteUrl],
    ["Privacy policy", review.app.privacyUrl ?? null],
    ["Terms", review.app.termsUrl ?? null],
  ] as const

  return (
    <div className="mx-auto grid w-full max-w-[1040px] grid-cols-1 gap-12 lg:grid-cols-[minmax(0,612px)_380px] lg:justify-between">
      <div className="flex min-w-0 flex-col">
        <Link
          to="/admin"
          className="flex w-fit items-center gap-1.5 text-[15.5px] text-sec hover:text-ink"
        >
          <Icon name="chevron-left" size={16} />
          Reviews
        </Link>
        <header className="mt-4 flex items-center gap-4">
          {logo.logo === null ? (
            <AppMark app={{ name: review.app.name, logoUrl: null }} size={56} />
          ) : (
            <img
              src={`data:${logo.logo.contentType};base64,${logo.logo.dataBase64}`}
              alt={`${review.app.name} logo as pinned`}
              className="size-14 rounded-full bg-soft object-cover"
            />
          )}
          <div>
            <h1 className="flex flex-wrap items-center gap-2.5 text-[30px] font-[650] tracking-[-0.02em] text-ink">
              {review.app.name}
              <span
                title={review.environment.kind === "live" ? "Live" : "Test"}
              >
                <Icon
                  name={
                    review.environment.kind === "live"
                      ? "globe"
                      : "flask-conical"
                  }
                  size={18}
                  strokeWidth={1.8}
                  className="text-sec"
                />
                <span className="sr-only">
                  {review.environment.kind === "live" ? "Live" : "Test"}
                </span>
              </span>
              <span className="rounded-full bg-soft2 px-2.5 py-0.5 text-[13.5px] font-semibold tracking-normal text-ink2">
                {stateNames[review.state]}
              </span>
            </h1>
            <p className="text-[16px] text-sec">{review.organization.name}</p>
          </div>
        </header>

        <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 rounded-[24px] bg-soft p-6 text-[15.5px] sm:grid-cols-2">
          {links.map(([term, href]) => (
            <div key={term}>
              <dt className="text-[14px] text-sec">{term}</dt>
              <dd className="mt-0.5 break-all text-ink">
                {href === null ? (
                  <span className="text-mut">None</span>
                ) : (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium underline underline-offset-[3px]"
                  >
                    {bare(href)}
                  </a>
                )}
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-[14px] text-sec">Support</dt>
            <dd className="mt-0.5 break-all font-medium text-ink">
              {review.app.supportEmail ?? (
                <span className="font-normal text-mut">None</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[14px] text-sec">Logo</dt>
            <dd className="mt-0.5 break-all text-ink">
              {logo.logo !== null
                ? `Pinned, sha256 ${logo.logo.sha256.slice(0, 12)}`
                : logo.notPinned !== null
                  ? `Not pinned: ${logo.notPinned.reason}`
                  : "No logo"}
            </dd>
          </div>
          <div>
            <dt className="text-[14px] text-sec">Submitter</dt>
            <dd className="mt-0.5 break-all font-medium text-ink">
              {review.submitterEmail ?? "Unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-[14px] text-sec">Submitted</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {submittedAt.format(new Date(review.createdAt))}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[14px] text-sec">Client ID</dt>
            <dd className="mt-1">
              <CopyField
                label="client ID"
                value={review.environment.clientId}
              />
            </dd>
          </div>
        </dl>

        <section aria-labelledby="scopes-title" className="mt-10">
          <h2
            id="scopes-title"
            className="mb-3 text-[18px] font-[650] text-ink"
          >
            Scopes
          </h2>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-[14px] text-sec">
                <th className="pb-3 font-normal">Scope</th>
                <th className="pb-3 font-normal max-sm:hidden">
                  Consent label
                </th>
                <th className="pb-3 font-normal">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.scope} className="border-b border-line">
                  <td className="py-3.5 font-mono text-[14.5px] text-ink">
                    {row.scope}
                  </td>
                  <td className="py-3.5 text-[15.5px] text-ink max-sm:hidden">
                    {row.consent}
                  </td>
                  <td className="py-3.5">
                    <span
                      className={`inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-semibold ${before.has(row.scope) ? "bg-pos-soft text-pos" : "bg-acc-soft text-acc-ink"}`}
                    >
                      {before.has(row.scope) ? "Approved" : "Added"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {context === null ? null : (
          <section aria-labelledby="context-title" className="mt-10">
            <h2
              id="context-title"
              className="mb-3 text-[18px] font-[650] text-ink"
            >
              Context
            </h2>
            <dl className="grid grid-cols-2 gap-4 rounded-[24px] bg-soft p-5 sm:grid-cols-4">
              {[
                [
                  "Test requests, 7d",
                  context.testUsage7d === null
                    ? "—"
                    : whole.format(context.testUsage7d.requests),
                ],
                [
                  "Test grants",
                  context.testActiveGrants === null
                    ? "—"
                    : whole.format(context.testActiveGrants),
                ],
                ["Prior reviews", whole.format(context.priorReviews)],
                [
                  "Scope version",
                  context.nextScopeVersion === null
                    ? `v${context.scopeVersion}`
                    : `v${context.scopeVersion} → v${context.nextScopeVersion}`,
                ],
              ].map(([term, value]) => (
                <div key={term}>
                  <dt className="text-[14px] text-sec">{term}</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold text-ink tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <Link
          to="/admin/audit"
          search={{ app: review.app.id }}
          className="mt-8 w-fit text-[15px] font-semibold text-ink underline underline-offset-[3px]"
        >
          Audit log for {review.app.name}
        </Link>

        {review.submitterNote === null ? null : (
          <section aria-labelledby="note-title" className="mt-10">
            <h2
              id="note-title"
              className="mb-3 text-[18px] font-[650] text-ink"
            >
              Submitter note
            </h2>
            <p className="whitespace-pre-wrap rounded-[24px] bg-soft p-5 text-[16px] text-ink">
              {review.submitterNote}
            </p>
          </section>
        )}
      </div>

      <aside className="h-fit rounded-[24px] bg-soft p-6 lg:mt-[120px]">
        <h2 className="text-[18px] font-[650] text-ink">Decision</h2>
        {open ? (
          <div className="mt-4 flex flex-col">
            <SegmentedControl.Root
              size="md"
              aria-label="Decision"
              value={decision}
              onValueChange={(value) => {
                if (
                  value === "approve" ||
                  value === "request-changes" ||
                  value === "reject"
                )
                  setDecision(value)
              }}
            >
              <SegmentedControl.Item value="approve">
                Approve
              </SegmentedControl.Item>
              <SegmentedControl.Item value="request-changes">
                Request changes
              </SegmentedControl.Item>
              <SegmentedControl.Item value="reject">
                Reject
              </SegmentedControl.Item>
            </SegmentedControl.Root>
            {decision === "approve" ? (
              <fieldset className="mt-6" disabled={pending}>
                <legend className="mb-2 text-[14.5px] text-sec">
                  Approved scopes
                </legend>
                <ol className="flex flex-col">
                  {review.requestedScopes.map((scope) => (
                    <li key={scope}>
                      <label className="flex h-10 items-center gap-3 font-mono text-[14.5px] text-ink">
                        <input
                          type="checkbox"
                          checked={approved.has(scope)}
                          disabled={scope === "openid"}
                          onChange={(event) =>
                            setApproved((current) => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(scope)
                              else next.delete(scope)
                              return next
                            })
                          }
                          className="size-5 accent-[var(--color-acc)]"
                        />
                        <span className="flex-1">{scope}</span>
                        <span className="font-sans text-[14px] text-sec">
                          {scope === "openid"
                            ? "Required"
                            : before.has(scope)
                              ? ""
                              : "Added"}
                        </span>
                      </label>
                    </li>
                  ))}
                </ol>
              </fieldset>
            ) : null}
            <label htmlFor={noteId} className="mt-6 text-[14.5px] text-sec">
              Note to developer
            </label>
            <textarea
              id={noteId}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 min-h-28 rounded-[20px] border border-line bg-bg p-4 text-[15.5px] text-ink outline-none max-md:text-[16px] focus:border-acc"
            />
            <PillButton.Root
              size="lg"
              intent={decision === "reject" ? "destructive" : "primary"}
              className="mt-5"
              pending={pending}
              disabled={decision === "approve" && approved.size === 0}
              onClick={() => void decide()}
            >
              <Icon name="lock" size={17} strokeWidth={2} />
              {decisionNames[decision]}
            </PillButton.Root>
          </div>
        ) : (
          <p className="mt-4 text-[16px] font-medium text-ink">
            {stateNames[review.state]}
            {review.reviewerNote === null ? "" : `: ${review.reviewerNote}`}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="mt-4 text-[15px] font-medium text-neg">
            {error}
          </p>
        )}
      </aside>
      {stepUp.sheet}
    </div>
  )
}
