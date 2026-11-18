import type { DeviceSession } from "@matchbox/contracts/identity"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { SeenAt } from "../lib/dates"
import { describeUserAgent, isMobileUserAgent } from "../lib/user-agent"

/**
 * Signed-in browsers. Signing this device out ends the page's session too,
 * so the router reloads and sends the visitor to sign in.
 */
export function DeviceSessions({
  sessions,
}: {
  sessions: readonly DeviceSession[]
}): ReactNode {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const others = sessions.filter((session) => !session.current)

  async function signOut(ids: readonly string[], key: string): Promise<void> {
    setPending(key)
    setError(null)
    try {
      for (const id of ids)
        await (await import("../lib/api")).api.revokeSession(id)
    } catch {
      setError("Sign out failed")
    } finally {
      setPending(null)
      await router.invalidate()
    }
  }

  return (
    <>
      <ul className="flex flex-col gap-1">
        {sessions.map((session) => (
          <li key={session.id} className="flex min-h-[76px] items-center gap-4">
            <span className="grid size-12 flex-none place-items-center rounded-full bg-soft text-ink">
              <Icon
                name={
                  isMobileUserAgent(session.userAgent)
                    ? "smartphone"
                    : "monitor"
                }
                size={19}
                strokeWidth={1.8}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[16px] font-semibold text-ink">
                  {describeUserAgent(session.userAgent)}
                </span>
                {session.current ? (
                  <span className="rounded-full bg-soft px-2 py-0.5 text-[13.5px] font-medium text-ink2">
                    This device
                  </span>
                ) : null}
              </p>
              {session.ipPrefix === null ? null : (
                <p className="text-[15px] text-sec">{session.ipPrefix}</p>
              )}
            </div>
            <p className="text-right max-sm:hidden">
              <span className="block text-[16px] font-semibold text-ink">
                <SeenAt iso={session.lastSeenAt ?? session.createdAt} />
              </span>
              <span className="block text-[15px] text-sec">Last seen</span>
            </p>
            <PillButton.Root
              intent="neutral"
              size="sm"
              className="bg-soft"
              pending={pending === session.id}
              disabled={pending !== null}
              onClick={() => void signOut([session.id], session.id)}
            >
              Sign out
            </PillButton.Root>
          </li>
        ))}
      </ul>
      {error === null ? null : (
        <p role="alert" className="mt-3 text-[15px] font-medium text-neg">
          {error}
        </p>
      )}
      {others.length === 0 ? null : (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-[24px] bg-soft py-3 pr-3 pl-6">
          <p className="text-[16px] font-semibold text-ink">
            Other sessions{" "}
            <span className="font-normal text-mut tabular-nums">
              {others.length}
            </span>
          </p>
          <PillButton.Root
            intent="neutral"
            pending={pending === "others"}
            disabled={pending !== null}
            onClick={() =>
              void signOut(
                others.map((session) => session.id),
                "others",
              )
            }
          >
            Sign out others
          </PillButton.Root>
        </div>
      )}
    </>
  )
}
