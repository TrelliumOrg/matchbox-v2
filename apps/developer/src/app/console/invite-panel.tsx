import * as PillButton from "@matchbox/ui/pill-button"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { errorMessage } from "../lib/api-error"
import { StepUpCancelledError, useStepUp } from "./step-up"

type Role = "owner" | "admin" | "developer"

const legend: { role: Role; label: string; detail: string }[] = [
  {
    role: "owner",
    label: "Owner",
    detail: "Billing, members, delete organization",
  },
  { role: "admin", label: "Admin", detail: "Members, apps, live keys" },
  {
    role: "developer",
    label: "Developer",
    detail: "Apps, test keys, usage, logs",
  },
]

/**
 * "Invite member" (`9BEhjD0P5q`): email and role, inline beside the
 * members. Only owners may invite owners (the server enforces it too).
 * Inviting an address that already has a pending invitation replaces it,
 * which is how Resend works.
 */
export function InvitePanel({
  orgId,
  owner,
}: {
  orgId: string
  owner: boolean
}): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const emailId = useId()
  const roleId = useId()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("developer")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const roles = legend.filter((entry) => owner || entry.role !== "owner")

  async function invite(event: FormEvent): Promise<void> {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const { orgs } = await import("../lib/api")
      await stepUp.run(() => orgs.invite(orgId, { email, role }))
      setEmail("")
      await router.invalidate()
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <aside className="flex flex-col gap-6">
      <form
        onSubmit={(event) => void invite(event)}
        className="flex flex-col gap-5 rounded-[28px] bg-soft p-6"
      >
        <fieldset>
          <legend className="mb-4 text-[20px] font-[650] text-ink">
            Invite member
          </legend>
          <ol className="flex flex-col gap-5">
            <li className="flex flex-col gap-2">
              <label htmlFor={emailId} className="text-[15px] text-sec">
                Email
              </label>
              <input
                id={emailId}
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12 rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink outline-none focus:border-acc"
              />
            </li>
            <li>
              <p id={roleId} className="mb-2 text-[15px] text-sec">
                Role
              </p>
              <SegmentedControl.Root
                aria-labelledby={roleId}
                value={role}
                onValueChange={(value) => {
                  const next = roles.find((entry) => entry.role === value)
                  if (next !== undefined) setRole(next.role)
                }}
              >
                {roles.map((entry) => (
                  <SegmentedControl.Item key={entry.role} value={entry.role}>
                    {entry.label}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </li>
          </ol>
        </fieldset>
        <PillButton.Root type="submit" size="lg" pending={pending}>
          Send invite
        </PillButton.Root>
        {error === null ? null : (
          <p role="alert" className="text-[15px] font-medium text-neg">
            {error}
          </p>
        )}
      </form>
      <section
        aria-labelledby="roles-title"
        className="flex flex-col gap-3 px-1"
      >
        <h3 id="roles-title" className="text-[16px] font-semibold text-ink">
          Roles
        </h3>
        <dl className="flex flex-col gap-3">
          {legend.map((entry) => (
            <div key={entry.role}>
              <dt className="text-[15.5px] font-medium text-ink">
                {entry.label}
              </dt>
              <dd className="text-[14.5px] text-sec">{entry.detail}</dd>
            </div>
          ))}
        </dl>
      </section>
      {stepUp.sheet}
    </aside>
  )
}
