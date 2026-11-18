import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { getQuotaOverrides } from "../data/console-api"
import type { QuotaOverride } from "../data/reads.server"
import { errorMessage } from "../lib/api-error"
import { shortDate } from "../lib/numbers"
import { StepUpCancelledError, useStepUp } from "./step-up"

/** Staff writes: step-up when asked, refresh, and the error to show. */
export function useStaffAction() {
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

export function QuotaOverrides({
  environmentId,
  initial = null,
}: {
  environmentId: string
  /** Overrides already read with the page; null loads them on request. */
  initial?: QuotaOverride[] | null
}): ReactNode {
  const action = useStaffAction()
  const ids = { minute: useId(), day: useId(), reason: useId() }
  const [overrides, setOverrides] = useState<QuotaOverride[] | null>(initial)
  const [form, setForm] = useState({ perMinute: "", perDay: "", reason: "" })

  async function load(): Promise<void> {
    setOverrides(await getQuotaOverrides({ data: { environmentId } }))
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    const done = await action.run("create", async () => {
      const { admin } = await import("../lib/api")
      await admin.createQuotaOverride(environmentId, {
        endpointClass: "gauge-profiles",
        perMinute: Number.parseInt(form.perMinute, 10),
        perDay: Number.parseInt(form.perDay, 10),
        reason: form.reason,
        expiresAt: null,
      })
    })
    if (done) {
      setForm({ perMinute: "", perDay: "", reason: "" })
      await load()
    }
  }

  if (overrides === null) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        className="cursor-pointer text-[14.5px] font-semibold text-ink underline underline-offset-[3px]"
      >
        Quota overrides
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-3 rounded-[16px] bg-raised p-4">
      {overrides.length === 0 ? (
        <p className="text-[14.5px] text-sec">No overrides</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {overrides.map((override) => (
            <li
              key={override.id}
              className="flex flex-wrap items-center gap-3 text-[14.5px]"
            >
              <span className="flex-1 text-ink">
                {override.perMinute}/min, {override.perDay}/day,{" "}
                {override.reason}
              </span>
              <span className="text-sec">
                {override.expiresAt === null
                  ? "No expiry"
                  : `Until ${shortDate(override.expiresAt)}`}
              </span>
              <PillButton.Root
                intent="neutral"
                size="sm"
                className="bg-soft"
                pending={action.pending === override.id}
                onClick={async () => {
                  const done = await action.run(override.id, async () => {
                    const { admin } = await import("../lib/api")
                    await admin.expireQuotaOverride(override.id)
                  })
                  if (done) await load()
                }}
              >
                Expire
              </PillButton.Root>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void create(event)}>
        <fieldset>
          <legend className="sr-only">New quota override</legend>
          <ol className="flex flex-wrap items-end gap-3">
            {(
              [
                ["perMinute", "Per minute", ids.minute, "number"],
                ["perDay", "Per day", ids.day, "number"],
                ["reason", "Reason", ids.reason, "text"],
              ] as const
            ).map(([key, label, id, type]) => (
              <li key={key} className="flex flex-col gap-1">
                <label htmlFor={id} className="text-[13.5px] text-sec">
                  {label}
                </label>
                <input
                  id={id}
                  type={type}
                  min={type === "number" ? 1 : undefined}
                  required
                  value={form[key]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  className="h-10 w-36 rounded-[12px] border border-line bg-bg px-3 text-[15px] text-ink"
                />
              </li>
            ))}
            <li>
              <PillButton.Root
                type="submit"
                size="sm"
                pending={action.pending === "create"}
              >
                Add override
              </PillButton.Root>
            </li>
          </ol>
        </fieldset>
      </form>
      {action.error === null ? null : (
        <p role="alert" className="text-[14.5px] font-medium text-neg">
          {action.error}
        </p>
      )}
      {action.sheet}
    </div>
  )
}
