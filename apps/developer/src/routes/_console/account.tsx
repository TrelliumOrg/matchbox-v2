import * as Avatar from "@matchbox/ui/avatar"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import {
  type FormEvent,
  lazy,
  type ReactNode,
  Suspense,
  useId,
  useState,
} from "react"
import { getMySessions } from "../../app/data/console-api"
import { errorMessage } from "../../app/lib/api-error"
import { initials, nameHue } from "../../app/lib/marks"
import { shortDate } from "../../app/lib/numbers"

const layout = getRouteApi("/_console")

const AppearancePicker = lazy(
  () => import("../../app/console/appearance-picker"),
)

/** "Chrome on macOS" from a stored User-Agent. */
function device(userAgent: string | null): string {
  if (userAgent === null || userAgent === "") return "Unknown device"
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser"
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null
  return os === null ? browser : `${browser} on ${os}`
}

/**
 * Account (`wAgKGwBMFx`, appearance `KXelB7l7UL`): profile, display name,
 * the Google email, appearance (the mode's palettes and haptics), sessions.
 */
export const Route = createFileRoute("/_console/account")({
  loader: async () => ({ sessions: await getMySessions() }),
  component: AccountPage,
})

function AccountPage(): ReactNode {
  const { sessions } = Route.useLoaderData()
  const { me, org } = layout.useLoaderData()
  const router = useRouter()
  const nameId = useId()
  const [name, setName] = useState(me.account.displayName)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(
    key: string,
    action: () => Promise<unknown>,
  ): Promise<void> {
    setPending(key)
    setError(null)
    try {
      await action()
      await router.invalidate()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    void act("name", async () => {
      const api = await import("../../app/lib/api")
      await api.me.update({ displayName: name })
    })
  }

  const others = sessions.filter((session) => !session.current)

  const membership = org
  const role =
    membership === null
      ? null
      : `${membership.role.charAt(0).toUpperCase()}${membership.role.slice(1)}, ${membership.name}`

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col [&>*]:max-w-[760px]">
      <h1 className="text-[32px] font-[650] tracking-[-0.02em] text-ink">
        Account
      </h1>

      <div className="mt-8 flex items-center gap-[18px]">
        <Avatar.Root
          initials={initials(me.account.displayName)}
          hue={nameHue(me.account.email)}
          size={64}
        />
        <p>
          <span className="block text-[16px] font-semibold text-ink">
            {me.account.displayName}
          </span>
          {role === null ? null : (
            <span className="block text-[15px] text-sec">{role}</span>
          )}
        </p>
      </div>

      <form onSubmit={save} className="mt-6 flex flex-col">
        <label htmlFor={nameId} className="text-[14px] text-sec">
          Display name
        </label>
        <input
          id={nameId}
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-2 h-[52px] rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink outline-none focus:border-acc focus:shadow-[0_0_0_3px_var(--color-acc-soft)]"
        />
        <p className="mt-6 text-[14px] text-sec">Email</p>
        <p className="mt-2 flex h-[52px] items-center gap-3 rounded-[16px] bg-soft px-4 text-[16px] text-ink2">
          <span className="min-w-0 flex-1 truncate">{me.account.email}</span>
          <span className="flex flex-none items-center gap-1.5 text-[14px] text-sec">
            <Icon name="lock" size={14} strokeWidth={1.8} />
            From Google
          </span>
        </p>
        <PillButton.Root
          type="submit"
          className="mt-6 self-end"
          pending={pending === "name"}
          disabled={name.trim() === me.account.displayName}
        >
          Save
        </PillButton.Root>
      </form>

      <section aria-labelledby="appearance-title" className="mt-10">
        <div className="mb-5 flex items-center gap-2">
          <h2 id="appearance-title" className="text-[24px] font-[650] text-ink">
            Appearance
          </h2>
        </div>
        <Suspense fallback={<div className="h-[420px]" />}>
          <AppearancePicker />
        </Suspense>
      </section>

      <section aria-labelledby="sessions-title" className="mt-12">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id="sessions-title" className="text-[24px] font-[650] text-ink">
            Sessions
          </h2>
          {others.length === 0 ? null : (
            <PillButton.Root
              intent="neutral"
              className="bg-soft"
              pending={pending === "others"}
              onClick={() =>
                void act("others", async () => {
                  const api = await import("../../app/lib/api")
                  await api.me.revokeOtherSessions()
                })
              }
            >
              Sign out other sessions
            </PillButton.Root>
          )}
        </div>
        <ul>
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center gap-4 py-3.5"
            >
              <span className="grid size-12 place-items-center rounded-full bg-soft text-ink">
                <Icon
                  name={
                    /iPhone|Android|Mobile/.test(session.userAgent ?? "")
                      ? "smartphone"
                      : "monitor"
                  }
                  size={18}
                  strokeWidth={1.8}
                />
              </span>
              <p className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-[16px] font-semibold text-ink">
                  {device(session.userAgent)}
                  {session.current ? (
                    <span className="rounded-full bg-pos-soft px-2 py-0.5 text-[13.5px] font-medium text-pos">
                      This device
                    </span>
                  ) : null}
                </span>
                <span className="block text-[15px] text-sec">
                  Last seen {shortDate(session.lastSeenAt ?? session.createdAt)}
                  {session.ipPrefix === null ? "" : `, ${session.ipPrefix}`}
                </span>
              </p>
              {session.current ? null : (
                <PillButton.Root
                  intent="neutral"
                  size="sm"
                  className="bg-soft"
                  pending={pending === session.id}
                  onClick={() =>
                    void act(session.id, async () => {
                      const api = await import("../../app/lib/api")
                      await api.me.revokeSession(session.id)
                    })
                  }
                >
                  Revoke
                </PillButton.Root>
              )}
            </li>
          ))}
        </ul>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-[15px] font-medium text-neg">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
