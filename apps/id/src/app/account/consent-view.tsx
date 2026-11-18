import type {
  AuthorizationRequestView,
  ClaimPreview,
  ConsentScope,
} from "@matchbox/contracts/identity"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as Switch from "@matchbox/ui/switch"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import type { IdentityAccountView } from "../../shared/contracts"
import { AppMark, WalletMark } from "../components/marks"
import { shortAddress } from "../lib/format"
import { legalLinks } from "../lib/legal"
import { networkNames } from "../lib/network"
import { DiscordLinkHint, ScopeIcon } from "./scope-parts"

export type ConsentDecision = "approve" | "deny"

export type ConsentViewProps = {
  request: AuthorizationRequestView
  account: IdentityAccountView
  pending: ConsentDecision | null
  error: string | null
  /** `declinedScopes`: optional scopes switched off (approve only). */
  onDecision: (decision: ConsentDecision, declinedScopes: string[]) => void
  onSwitchAccount: () => void
}

/** Servers predating optional scopes send no requirement: required. */
function isOptional(scope: ConsentScope): boolean {
  return scope.requirement === "optional"
}

/** Optional scopes start off when declined before or unavailable now. */
export function initiallyOff(scopes: readonly ConsentScope[]): Set<string> {
  return new Set(
    scopes
      .filter(
        (scope) =>
          isOptional(scope) &&
          (scope.previouslyDeclined === true || !scope.available),
      )
      .map((scope) => scope.scope),
  )
}

/** The optional, available scopes the user switched off. */
export function declinedScopes(
  scopes: readonly ConsentScope[],
  off: ReadonlySet<string>,
): string[] {
  return scopes
    .filter(
      (scope) => isOptional(scope) && scope.available && off.has(scope.scope),
    )
    .map((scope) => scope.scope)
}

function websiteHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return "Website"
  }
}

const joinedDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function claim(
  scope: ConsentScope,
  name: ClaimPreview["claim"],
): string | null {
  return scope.claims.find((entry) => entry.claim === name)?.value ?? null
}

/** The user's own values for a scope, as the consent rows show them. */
function ScopeDetail({
  scope,
  appName,
}: {
  scope: ConsentScope
  appName: string
}): ReactNode {
  if (scope.unavailableReason === "discord-not-linked") {
    return <DiscordLinkHint />
  }
  if (scope.scope === "openid") return <>Unique to {appName}</>
  if (scope.scope === "wallet") {
    const network = claim(scope, "wallet_network")
    return (
      <>
        {network === "mezo" || network === "mezo-testnet"
          ? networkNames[network]
          : (network ?? scope.description)}
      </>
    )
  }
  if (scope.scope === "discord:id") {
    const username = claim(scope, "discord_username")
    const id = claim(scope, "discord_id")
    return (
      <>
        {username === null ? null : <span className="block">{username}</span>}
        {id === null ? null : (
          <span className="block font-mono text-[13px] text-mut">{id}</span>
        )}
      </>
    )
  }
  if (scope.scope === "discord:profile") {
    const avatar = claim(scope, "discord_avatar_url")
    const display = claim(scope, "discord_display_name")
    const username = claim(scope, "discord_username")
    return (
      <>
        <span className="flex items-center gap-2">
          {avatar === null ? null : (
            <img
              src={avatar}
              alt=""
              referrerPolicy="no-referrer"
              className="size-5 rounded-full bg-soft"
            />
          )}
          {display ?? username ?? scope.description}
        </span>
        {username === null || display === null ? null : (
          <span className="block pl-7 text-[13.5px] text-mut">@{username}</span>
        )}
      </>
    )
  }
  if (scope.scope === "discord:membership") {
    const joined = claim(scope, "discord_joined_at")
    if (joined === null)
      return <>{scope.available ? "Not a member" : scope.description}</>
    const date = new Date(joined)
    return (
      <>
        Joined{" "}
        <time dateTime={joined}>
          {Number.isNaN(date.getTime()) ? joined : joinedDate.format(date)}
        </time>
      </>
    )
  }
  return <>{scope.description}</>
}

function ScopeRow({
  scope,
  appName,
  on,
  disabled,
  onToggle,
}: {
  scope: ConsentScope
  appName: string
  on: boolean
  disabled: boolean
  onToggle: (on: boolean) => void
}): ReactNode {
  const labelId = useId()
  const optional = isOptional(scope)
  const isNew = !scope.previouslyGranted && scope.previouslyDeclined !== true
  return (
    <li className="flex min-h-[66px] items-center gap-3.5 border-t border-line py-3 first:border-t-0">
      <span className="grid size-10 flex-none place-items-center rounded-full bg-soft text-ink">
        <ScopeIcon scope={scope.scope} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span id={labelId} className="text-[15.5px] font-semibold text-ink">
            {scope.label}
          </span>
          {isNew && scope.available ? (
            <span className="rounded-full bg-acc-soft px-2 py-0.5 text-[13px] font-semibold text-acc-ink">
              New
            </span>
          ) : null}
        </p>
        <div
          className={`mt-0.5 text-[14.5px] text-sec transition-opacity ${on || !optional ? "" : "opacity-50"}`}
        >
          <ScopeDetail scope={scope} appName={appName} />
        </div>
      </div>
      {optional ? (
        <Switch.Root
          aria-labelledby={labelId}
          checked={on}
          disabled={disabled || !scope.available}
          onCheckedChange={onToggle}
        />
      ) : (
        <span
          className={`text-[14.5px] ${scope.available ? "text-mut" : "font-semibold text-neg"}`}
        >
          {scope.available ? "Required" : "Unavailable"}
        </span>
      )}
    </li>
  )
}

/** Who is asking, as which wallet, for what, sent where. */
export function ConsentView({
  request,
  account,
  pending,
  error,
  onDecision,
  onSwitchAccount,
}: ConsentViewProps): ReactNode {
  const titleId = useId()
  const [off, setOff] = useState(() => initiallyOff(request.scopes))
  const { app } = request
  const links = [
    {
      label: app.websiteUrl === null ? null : websiteHost(app.websiteUrl),
      href: app.websiteUrl,
    },
    { label: "Privacy", href: app.privacyUrl },
    { label: "Terms", href: app.termsUrl },
  ].filter(
    (link): link is { label: string; href: string } =>
      link.href !== null && link.label !== null,
  )

  function toggle(scope: string, on: boolean): void {
    setOff((current) => {
      const next = new Set(current)
      if (on) next.delete(scope)
      else next.add(scope)
      return next
    })
  }

  return (
    <article
      aria-labelledby={titleId}
      className="mx-auto flex w-full max-w-[560px] flex-col pt-9 max-md:pt-2"
    >
      <AppMark name={app.name} logoUrl={app.logoUrl} size={52} />
      <h1
        id={titleId}
        className="mt-6 text-[32px] font-[650] leading-[1.15] tracking-[-0.02em] text-ink max-md:text-[26px]"
      >
        Allow {app.name} to sign you in
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px]">
        {app.verified ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 font-medium text-ink">
            <Icon name="check" size={13} strokeWidth={2.2} />
            Verified
          </span>
        ) : null}
        {request.environmentKind === "test" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 font-medium text-ink">
            <Icon name="flask-conical" size={13} strokeWidth={2} />
            {networkNames[request.network]}
          </span>
        ) : null}
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink2 underline underline-offset-[3px] hover:text-ink"
          >
            {link.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ))}
      </div>

      <div className="mt-7 rounded-[32px] bg-soft p-6 max-md:-mx-1 max-md:rounded-[26px] max-md:p-3">
        <section
          aria-label="Account"
          className="flex items-center gap-3.5 rounded-[20px] bg-raised p-3"
        >
          <WalletMark address={account.walletAddress} />
          <p className="min-w-0 flex-1">
            <span
              title={account.walletAddress}
              className="block font-mono text-[15.5px] font-medium text-ink"
            >
              <span aria-hidden="true">
                {shortAddress(account.walletAddress)}
              </span>
              <span className="sr-only">{account.walletAddress}</span>
            </span>
            <span className="block text-[14.5px] text-sec">
              {account.signedInNetwork === null
                ? "Wallet"
                : networkNames[account.signedInNetwork]}
            </span>
          </p>
          <PillButton.Root
            intent="neutral"
            size="sm"
            className="bg-soft"
            disabled={pending !== null}
            onClick={onSwitchAccount}
          >
            Switch
          </PillButton.Root>
        </section>

        <ul
          aria-label="Requested"
          className="mt-4 rounded-[20px] bg-raised px-4 py-1"
        >
          {request.scopes.map((scope) => (
            <ScopeRow
              key={scope.scope}
              scope={scope}
              appName={app.name}
              on={!off.has(scope.scope) && scope.available}
              disabled={pending !== null}
              onToggle={(on) => toggle(scope.scope, on)}
            />
          ))}
        </ul>

        <p className="mt-4 flex items-center justify-between gap-3 px-1 text-[15px]">
          <span className="text-sec">Redirect</span>
          <span className="min-w-0 break-all font-medium text-ink">
            {request.redirectHost}
          </span>
        </p>
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-4 text-[15px] font-medium text-neg">
          {error}
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <PillButton.Root
          intent="neutral"
          size="lg"
          className="bg-soft"
          pending={pending === "deny"}
          disabled={pending !== null}
          onClick={() => onDecision("deny", [])}
        >
          Cancel
        </PillButton.Root>
        <PillButton.Root
          size="lg"
          pending={pending === "approve"}
          disabled={pending !== null || !request.approvable}
          onClick={() =>
            onDecision("approve", declinedScopes(request.scopes, off))
          }
        >
          Allow
        </PillButton.Root>
      </div>

      <p className="mt-5 flex flex-wrap justify-center gap-5 text-[14px] text-sec">
        <a
          href={legalLinks.privacy}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-[3px] hover:text-ink"
        >
          Matchbox ID privacy
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <Link
          to="/"
          className="underline underline-offset-[3px] hover:text-ink"
        >
          Revoke in Connected apps
        </Link>
      </p>
    </article>
  )
}
