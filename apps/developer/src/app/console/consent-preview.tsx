import type { AuthorizationRequestDetail } from "@matchbox/contracts/identity"
import type { ReactNode } from "react"
import type { OAuthExtras } from "../data/console-api"
import { AppMark } from "./app-row"
import { Glyph } from "./glyphs"
import { scopeRows } from "./scope-rows"

const whole = new Intl.NumberFormat("en-US")

/**
 * The consent screen people will see (`ue1xxOLm6q`, Classic's consent
 * preview): the app, each scope with its wording and whether it can be
 * declined. A picture only; nothing here is clickable.
 */
function ConsentCard({
  preview,
}: {
  preview: AuthorizationRequestDetail
}): ReactNode {
  return (
    <figure
      aria-label="Consent preview"
      className="overflow-hidden rounded-[24px] bg-soft"
    >
      <div className="flex h-[56px] items-center gap-3 bg-ink px-3 text-bg">
        <AppMark app={preview.app} size={32} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-[650]">
          {preview.app.name}
        </span>
        <span className="rounded-full bg-bg/15 px-2.5 py-1 text-[13px] font-semibold">
          {preview.environmentKind === "live" ? "Live" : "Test"}
        </span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[14.5px] text-sec">
          {preview.app.name} wants to know
        </p>
        <ul className="flex flex-col rounded-[18px] bg-bg px-3">
          {preview.scopes.map((scope) => {
            const glyph =
              scopeRows.find((row) => row.scope === scope.scope)?.glyph ?? "key"
            const optional = scope.requirement === "optional"
            return (
              <li
                key={scope.scope}
                className="flex items-center gap-3 border-t border-line py-3 first:border-t-0"
              >
                <span className="grid size-9 flex-none place-items-center rounded-full bg-soft text-ink">
                  <Glyph name={glyph} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">
                    {scope.label}
                  </span>
                  <span className="block text-[13.5px] text-sec">
                    {scope.description}
                  </span>
                </span>
                <span className="text-[13px] text-sec">
                  {optional ? "Optional" : "Required"}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="text-[13.5px] text-sec">
          Returns to {preview.redirectOrigin}
        </p>
      </div>
    </figure>
  )
}

/** The consent preview and 30-day grant stats beside the OAuth settings. */
export function OAuthAside({
  extras,
}: {
  extras: OAuthExtras | null
}): ReactNode {
  if (extras === null) return null
  const stats = extras.stats
  return (
    <aside className="flex flex-col gap-6">
      {extras.preview === null ? (
        <p className="rounded-[24px] bg-soft p-5 text-[15px] text-sec">
          Request a Matchbox ID scope to see the consent screen
        </p>
      ) : (
        <ConsentCard preview={extras.preview} />
      )}
      {stats === null ? null : (
        <section
          aria-labelledby="grants-title"
          className="rounded-[24px] bg-soft p-5"
        >
          <h3 id="grants-title" className="text-[16px] font-semibold text-ink">
            Grants, 30d
          </h3>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            {[
              ["Active", stats.activeGrants],
              ["New", stats.grantsCreated],
              ["Revoked", stats.revocations.total],
            ].map(([term, value]) => (
              <div key={term}>
                <dt className="text-[13.5px] text-sec">{term}</dt>
                <dd className="text-[20px] font-[650] text-ink tabular-nums">
                  {whole.format(Number(value))}
                </dd>
              </div>
            ))}
          </dl>
          {stats.awaitingReconsent === undefined ||
          stats.awaitingReconsent.count === 0 ? null : (
            <p className="mt-3 text-[14px] text-sec">
              {whole.format(stats.awaitingReconsent.count)} awaiting consent to
              scope version {stats.awaitingReconsent.currentScopeVersion}
            </p>
          )}
          {stats.grantsByScope.length === 0 ? null : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {stats.grantsByScope.map((entry) => (
                <li
                  key={entry.scope}
                  className="flex justify-between text-[14px]"
                >
                  <span className="font-mono text-ink2">{entry.scope}</span>
                  <span className="text-ink tabular-nums">
                    {whole.format(entry.activeGrants)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </aside>
  )
}
