import type { Invitation, Member } from "@matchbox/contracts/console"
import * as Avatar from "@matchbox/ui/avatar"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { Empty } from "../../app/components/states"
import { InvitePanel } from "../../app/console/invite-panel"
import { OrgSettings } from "../../app/console/org-settings"
import { StepUpCancelledError, useStepUp } from "../../app/console/step-up"
import { getOrganization } from "../../app/data/console-api"
import { errorMessage } from "../../app/lib/api-error"
import { initials, nameHue } from "../../app/lib/marks"
import { shortDate } from "../../app/lib/numbers"

const layout = getRouteApi("/_console")

const roles = ["owner", "admin", "developer"] as const
const roleNames = { owner: "Owner", admin: "Admin", developer: "Developer" }

/**
 * Organization (`9BEhjD0P5q`, built without its frame this round: Doop was
 * down): members with roles, pending invitations and the invite sheet.
 * Owners and admins manage; role changes and removals need a step-up.
 */
export const Route = createFileRoute("/_console/organization")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const org = parent.loaderData?.org ?? null
    if (org === null) return { members: [], invitations: null, activity: null }
    return getOrganization({ data: { orgId: org.id } })
  },
  component: OrganizationPage,
})

function MemberRow({
  member,
  orgId,
  manage,
  self,
}: {
  member: Member
  orgId: string
  manage: boolean
  self: boolean
}): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function act(action: () => Promise<unknown>): Promise<void> {
    setPending(true)
    setError(null)
    try {
      await stepUp.run(action)
      setConfirming(false)
      await router.invalidate()
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 border-t border-line py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-4">
        {member.avatarUrl === null ? (
          <Avatar.Root
            initials={initials(member.displayName)}
            hue={nameHue(member.accountId)}
            size={44}
          />
        ) : (
          <img
            src={member.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-11 rounded-full bg-soft object-cover"
          />
        )}
        <p className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold text-ink">
            {member.displayName}
            {self ? (
              <span className="ml-2 text-[14px] font-normal text-sec">You</span>
            ) : null}
          </span>
          <span className="block truncate text-[14.5px] text-sec">
            {member.email}
          </span>
        </p>
        {manage && !self ? (
          <span className="flex items-center gap-2 max-sm:basis-full max-sm:justify-end">
            <label className="sr-only" htmlFor={`role-${member.accountId}`}>
              Role for {member.displayName}
            </label>
            <select
              id={`role-${member.accountId}`}
              value={member.role}
              disabled={pending}
              onChange={(event) => {
                const role = roles.find((value) => value === event.target.value)
                if (role === undefined) return
                void act(async () => {
                  const { orgs } = await import("../../app/lib/api")
                  await orgs.updateMember(orgId, member.accountId, role)
                })
              }}
              className="h-10 rounded-[20px] border border-line bg-bg px-3 text-[15px] text-ink max-md:text-[16px]"
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {roleNames[role]}
                </option>
              ))}
            </select>
            <PillButton.Root
              intent="neutral"
              size="sm"
              className="bg-soft"
              disabled={confirming}
              onClick={() => setConfirming(true)}
            >
              Remove
            </PillButton.Root>
          </span>
        ) : (
          <span className="text-[15px] text-sec">{roleNames[member.role]}</span>
        )}
      </div>
      {confirming ? (
        <section
          aria-label={`Remove ${member.displayName}`}
          className="flex flex-wrap items-center gap-3 rounded-[20px] bg-neg-soft p-4"
        >
          <p className="min-w-0 flex-1 text-[15.5px] font-semibold text-ink">
            Remove {member.displayName}?
          </p>
          <PillButton.Root
            intent="neutral"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </PillButton.Root>
          <PillButton.Root
            intent="destructive"
            pending={pending}
            onClick={() =>
              void act(async () => {
                const { orgs } = await import("../../app/lib/api")
                await orgs.removeMember(orgId, member.accountId)
              })
            }
          >
            Remove
          </PillButton.Root>
        </section>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-[15px] font-medium text-neg">
          {error}
        </p>
      )}
      {stepUp.sheet}
    </li>
  )
}

function InvitationRow({
  invitation,
  orgId,
}: {
  invitation: Invitation
  orgId: string
}): ReactNode {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <li className="flex flex-wrap items-center gap-4 border-t border-line py-4 first:border-t-0">
      <span className="grid size-11 place-items-center rounded-full bg-soft text-ink">
        <Icon name="arrow-up-right" size={17} strokeWidth={1.8} />
      </span>
      <p className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[16px] font-semibold text-ink">
          <span className="truncate">{invitation.email}</span>
          <span className="rounded-full bg-acc-soft px-2 py-0.5 text-[13px] font-semibold text-acc-ink">
            Pending
          </span>
        </span>
        <span className="block text-[14.5px] text-sec">
          {roleNames[invitation.role]}, expires{" "}
          {shortDate(invitation.expiresAt)}
        </span>
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true)
          setError(null)
          try {
            const { orgs } = await import("../../app/lib/api")
            await orgs.invite(orgId, {
              email: invitation.email,
              role: invitation.role,
            })
            await router.invalidate()
          } catch (caught) {
            setError(errorMessage(caught))
          } finally {
            setPending(false)
          }
        }}
        className="cursor-pointer text-[15px] font-semibold text-ink underline underline-offset-[3px]"
      >
        Resend
      </button>
      <PillButton.Root
        intent="neutral"
        size="sm"
        className="bg-soft"
        pending={pending}
        onClick={async () => {
          setPending(true)
          setError(null)
          try {
            const { orgs } = await import("../../app/lib/api")
            await orgs.revokeInvitation(orgId, invitation.id)
            await router.invalidate()
          } catch (caught) {
            setError(errorMessage(caught))
          } finally {
            setPending(false)
          }
        }}
      >
        Revoke
      </PillButton.Root>
      {error === null ? null : (
        <p role="alert" className="w-full text-[15px] font-medium text-neg">
          {error}
        </p>
      )}
    </li>
  )
}

function OrganizationPage(): ReactNode {
  const { members, invitations, activity } = Route.useLoaderData()
  const { me, org } = layout.useLoaderData()
  if (org === null) return null
  const manage = org.role === "owner" || org.role === "admin"
  const pending = (invitations ?? []).filter(
    (invitation) =>
      invitation.acceptedAt === null && invitation.revokedAt === null,
  )
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-[14px] bg-ink text-[15px] font-bold text-bg">
            {initials(org.name)}
          </span>
          <div>
            <h1 className="text-[34px] font-[650] tracking-[-0.02em] text-ink max-sm:text-[26px]">
              {org.name}
            </h1>
            <p className="font-mono text-[13.5px] text-sec">{org.slug}</p>
          </div>
        </div>
        {manage ? (
          <OrgSettings
            orgId={org.id}
            name={org.name}
            owner={org.role === "owner"}
          />
        ) : null}
      </header>

      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <section aria-labelledby="members-title">
            <h2
              id="members-title"
              className="mb-3 text-[22px] font-[650] text-ink"
            >
              Members{" "}
              <span className="font-normal text-mut tabular-nums">
                {members.length}
              </span>
            </h2>
            <ul>
              {members.map((member) => (
                <MemberRow
                  key={member.accountId}
                  member={member}
                  orgId={org.id}
                  manage={manage}
                  self={member.accountId === me.account.id}
                />
              ))}
            </ul>
          </section>

          {invitations === null ? null : (
            <section aria-labelledby="invitations-title" className="mt-12">
              <h2
                id="invitations-title"
                className="mb-3 text-[22px] font-[650] text-ink"
              >
                Invitations{" "}
                <span className="font-normal text-mut tabular-nums">
                  {pending.length}
                </span>
              </h2>
              {pending.length === 0 ? (
                <Empty title="No pending invitations" />
              ) : (
                <ul>
                  {pending.map((invitation) => (
                    <InvitationRow
                      key={invitation.id}
                      invitation={invitation}
                      orgId={org.id}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
          {activity === null || activity.length === 0 ? null : (
            <section aria-labelledby="activity-title" className="mt-12">
              <h2
                id="activity-title"
                className="mb-3 text-[22px] font-[650] text-ink"
              >
                Recent activity
              </h2>
              <ul>
                {activity.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-4 border-t border-line py-3 first:border-t-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15.5px] font-medium text-ink">
                        {event.action.replaceAll(".", " ").replaceAll("_", " ")}
                      </span>
                      <span className="block truncate text-[14px] text-sec">
                        {event.targetType ?? ""} {event.targetId ?? ""}
                      </span>
                    </span>
                    <span className="text-[14.5px] text-sec tabular-nums">
                      {shortDate(event.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {manage ? (
          <InvitePanel orgId={org.id} owner={org.role === "owner"} />
        ) : null}
      </div>
    </div>
  )
}
