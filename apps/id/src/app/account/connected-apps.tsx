import type {
  EndedGrant,
  GrantRevokedReason,
} from "@matchbox/contracts/identity"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import type {
  ConnectedAppView,
  GrantListViewResponse,
} from "../../shared/contracts"
import { Glyph } from "../components/glyphs"
import { AppMark } from "../components/marks"
import { ShortDate } from "../lib/dates"
import { networkNames } from "../lib/network"
import { ScopeIcon } from "./scope-parts"

const endedReasons = {
  "user-revoked": "Revoked",
  "app-suspended": "App suspended",
  "discord-link-changed": "Discord link changed",
  "scope-changed": "Scopes changed",
  "account-disabled": "Account disabled",
} as const satisfies Record<GrantRevokedReason, string>

function endedReason(reason: GrantRevokedReason | null): string {
  return reason === null ? "Ended" : endedReasons[reason]
}

const scopeNames: Record<string, string> = {
  openid: "Sign-in ID",
  wallet: "Wallet",
  "discord:id": "Discord ID",
  "discord:profile": "Discord profile",
  "discord:membership": "Mezo Discord membership",
}

function ScopeIcons({ scopes }: { scopes: readonly string[] }): ReactNode {
  return (
    <ul className="mt-1.5 flex items-center gap-2.5 text-ink2">
      {scopes.map((scope) => (
        <li key={scope} title={scopeNames[scope] ?? scope}>
          <ScopeIcon scope={scope} size={16} />
          <span className="sr-only">{scopeNames[scope] ?? scope}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * One app. Revoke opens the confirmation in place (the design's red row);
 * Cancel gets focus so Enter never revokes by accident.
 */
function AppRow({
  grant,
  confirming,
  onConfirm,
  onCancel,
  onRevoked,
}: {
  grant: ConnectedAppView
  confirming: boolean
  onConfirm: () => void
  onCancel: () => void
  onRevoked: () => Promise<void>
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (confirming) cancelRef.current?.focus()
  }, [confirming])

  async function revoke(): Promise<void> {
    setPending(true)
    setError(null)
    try {
      await (await import("../lib/api")).api.revokeGrant(grant.id)
      await onRevoked()
    } catch {
      setError("Revoke failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex flex-col gap-2">
      <div className="flex min-h-[76px] items-center gap-4">
        <AppMark name={grant.app.name} logoUrl={grant.app.logoUrl} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span id={titleId} className="text-[16px] font-semibold text-ink">
              {grant.app.name}
            </span>
            {grant.verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-soft px-2 py-0.5 text-[13.5px] font-medium text-ink2">
                <Icon name="check" size={13} strokeWidth={2.2} />
                Verified
              </span>
            ) : null}
            {grant.environmentKind === "test" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-soft px-2 py-0.5 text-[13.5px] font-medium text-ink2">
                <Icon name="flask-conical" size={13} strokeWidth={2} />
                {networkNames[grant.network]}
              </span>
            ) : null}
          </p>
          <ScopeIcons scopes={grant.scopes} />
        </div>
        <p className="text-right text-[15px] text-sec max-sm:hidden">
          Granted <ShortDate iso={grant.createdAt} />
        </p>
        <PillButton.Root
          intent="neutral"
          size="sm"
          className="bg-soft"
          aria-describedby={titleId}
          disabled={confirming}
          onClick={onConfirm}
        >
          Revoke
        </PillButton.Root>
      </div>
      {confirming ? (
        <section
          aria-label={`Revoke ${grant.app.name}`}
          className="flex flex-wrap items-center gap-4 rounded-[24px] bg-neg-soft p-4"
        >
          <span className="grid size-10 flex-none place-items-center rounded-full bg-raised text-neg">
            <Glyph name="ban" size={18} />
          </span>
          <p className="min-w-0 flex-1">
            <span className="block text-[15.5px] font-semibold text-ink">
              Revoke {grant.app.name}?
            </span>
            <span className="block text-[15px] text-ink2">
              Data already shared stays with {grant.app.name}
            </span>
            {error === null ? null : (
              <span
                role="alert"
                className="block text-[14.5px] font-medium text-neg"
              >
                {error}
              </span>
            )}
          </p>
          <span className="flex gap-2">
            <PillButton.Root
              ref={cancelRef}
              intent="neutral"
              disabled={pending}
              onClick={onCancel}
            >
              Cancel
            </PillButton.Root>
            <PillButton.Root
              intent="destructive"
              pending={pending}
              onClick={() => void revoke()}
            >
              Revoke
            </PillButton.Root>
          </span>
        </section>
      ) : null}
    </li>
  )
}

function EndedGrants({ ended }: { ended: readonly EndedGrant[] }): ReactNode {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const [latest] = ended
  if (latest === undefined) return null
  return (
    <section
      aria-label="Ended"
      className="mt-6 rounded-[24px] bg-soft px-6 py-4"
    >
      <div className="flex items-center gap-5">
        <p className="text-[16px] font-semibold text-ink">
          Ended{" "}
          <span className="font-normal text-mut tabular-nums">
            {ended.length}
          </span>
        </p>
        {open ? null : (
          <p className="min-w-0 flex-1 truncate text-[14.5px]">
            <span className="block truncate font-medium text-ink">
              {latest.app.name}
            </span>
            <span className="block text-sec">
              {endedReason(latest.revokedReason)}{" "}
              <ShortDate iso={latest.revokedAt} />
            </span>
          </p>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[15px] font-semibold text-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          {open ? "Hide" : "Show"}
          <Icon
            name="chevron-down"
            size={16}
            className={open ? "rotate-180" : undefined}
          />
        </button>
      </div>
      {open ? (
        <ul id={listId} className="mt-3 flex flex-col">
          {ended.map((grant) => (
            <li
              key={grant.id}
              className="flex items-center gap-4 border-t border-line py-3"
            >
              <AppMark
                name={grant.app.name}
                logoUrl={grant.app.logoUrl}
                size={36}
              />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
                {grant.app.name}
              </span>
              <span className="text-[14.5px] text-sec">
                {endedReason(grant.revokedReason)}{" "}
                {grant.revokedAt === null ? null : (
                  <ShortDate iso={grant.revokedAt} />
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** Apps holding an active grant (scopes, revoke), then ended grants. */
export function ConnectedApps({
  grants,
}: {
  grants: GrantListViewResponse
}): ReactNode {
  const router = useRouter()
  const [confirming, setConfirming] = useState<string | null>(null)
  const active = grants.data

  return (
    <>
      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[24px] border border-dashed border-dash px-6 py-16">
          <span className="grid size-[52px] place-items-center rounded-full bg-soft text-ink">
            <Glyph name="layout-grid" size={20} />
          </span>
          <p className="text-[16px] font-medium text-ink">No connected apps</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {active.map((grant) => (
            <AppRow
              key={grant.id}
              grant={grant}
              confirming={confirming === grant.id}
              onConfirm={() => setConfirming(grant.id)}
              onCancel={() => setConfirming(null)}
              onRevoked={async () => {
                setConfirming(null)
                await router.invalidate()
              }}
            />
          ))}
        </ul>
      )}
      <EndedGrants ended={grants.ended} />
    </>
  )
}
