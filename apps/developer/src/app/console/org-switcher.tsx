import type { OrganizationSummary } from "@matchbox/contracts/console"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { errorMessage } from "../lib/api-error"
import { initials } from "../lib/marks"

const roleNames = { owner: "Owner", admin: "Admin", developer: "Developer" }

/** Creates an organization (POST /api/orgs) and switches to it, as Classic did. */
export function CreateOrganization({
  onDone,
}: {
  onDone?: () => void
}): ReactNode {
  const router = useRouter()
  const nameId = useId()
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const { orgs } = await import("../lib/api")
      const created = await orgs.create({ name: name.trim() })
      onDone?.()
      await router.invalidate()
      await router.navigate({ to: "/", search: { org: created.id } })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void create(event)}
      className="flex flex-col gap-3"
    >
      <fieldset>
        <legend className="sr-only">New organization</legend>
        <ol>
          <li className="flex flex-col gap-2">
            <label htmlFor={nameId} className="text-[15px] text-sec">
              Organization name
            </label>
            <span className="flex gap-2">
              <input
                id={nameId}
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-11 min-w-0 flex-1 rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink outline-none focus:border-acc"
              />
              <PillButton.Root type="submit" pending={pending}>
                Create
              </PillButton.Root>
            </span>
          </li>
        </ol>
      </fieldset>
      {error === null ? null : (
        <p role="alert" className="text-[15px] font-medium text-neg">
          {error}
        </p>
      )}
    </form>
  )
}

/**
 * The organization block at the foot of the sidebar: switches between the
 * account's organizations (`?org=`) and creates new ones.
 */
export function OrgSwitcher({
  current,
  organizations,
}: {
  current: OrganizationSummary
  organizations: OrganizationSummary[]
}): ReactNode {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const listId = useId()
  return (
    <div className="relative mt-auto">
      {open ? (
        <div
          id={listId}
          className="absolute right-0 bottom-full left-0 mb-2 flex flex-col gap-1 rounded-[20px] bg-pop p-2 shadow-pop"
        >
          {organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              aria-current={org.id === current.id ? "true" : undefined}
              onClick={() => {
                setOpen(false)
                void router.navigate({ to: "/", search: { org: org.id } })
              }}
              className="flex h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-left text-[15px] font-medium text-ink hover:bg-soft aria-[current]:bg-soft"
            >
              <span className="grid size-7 place-items-center rounded-[8px] bg-ink text-[11px] font-bold text-bg">
                {initials(org.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              <span className="text-[13px] text-sec">
                {roleNames[org.role]}
              </span>
            </button>
          ))}
          {creating ? (
            <div className="p-2">
              <CreateOrganization onDone={() => setOpen(false)} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-[15px] font-medium text-ink hover:bg-soft"
            >
              <span className="grid size-7 place-items-center rounded-[8px] bg-soft">
                <Icon name="plus" size={15} />
              </span>
              New organization
            </button>
          )}
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((value) => !value)
          setCreating(false)
        }}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[20px] bg-soft p-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        <span className="grid size-9 place-items-center rounded-[10px] bg-ink text-[13px] font-bold text-bg">
          {initials(current.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">
            {current.name}
          </span>
          <span className="block text-[13.5px] text-sec">
            {roleNames[current.role]}
          </span>
        </span>
        <Icon
          name="chevron-down"
          size={16}
          className={open ? "rotate-180" : undefined}
        />
      </button>
    </div>
  )
}
