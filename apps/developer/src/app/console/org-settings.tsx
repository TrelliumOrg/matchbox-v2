import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { errorMessage } from "../lib/api-error"
import { StepUpCancelledError, useStepUp } from "./step-up"

/**
 * Organization "Edit" (`9BEhjD0P5q`, Classic's organization settings):
 * rename, and delete for owners after a confirmation. The server enforces
 * who may do either and asks for a step-up when it wants one.
 */
export function OrgSettings({
  orgId,
  name,
  owner,
}: {
  orgId: string
  name: string
  owner: boolean
}): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const nameId = useId()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(name)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState<"save" | "delete" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(
    kind: "save" | "delete",
    action: () => Promise<unknown>,
  ): Promise<boolean> {
    setPending(kind)
    setError(null)
    try {
      await stepUp.run(action)
      return true
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
      return false
    } finally {
      setPending(null)
    }
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    void act("save", async () => {
      const { orgs } = await import("../lib/api")
      await orgs.update(orgId, { name: value.trim() })
    }).then(async (done) => {
      if (done) {
        setOpen(false)
        await router.invalidate()
      }
    })
  }

  if (!open) {
    return (
      <PillButton.Root
        intent="neutral"
        className="bg-soft"
        onClick={() => setOpen(true)}
      >
        Edit
      </PillButton.Root>
    )
  }
  return (
    <section
      aria-label="Organization settings"
      className="flex w-full flex-col gap-4 rounded-[24px] bg-soft p-5"
    >
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <span className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={nameId} className="text-[14px] text-sec">
            Name
          </label>
          <input
            id={nameId}
            required
            maxLength={80}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="h-11 rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink"
          />
        </span>
        <PillButton.Root type="submit" pending={pending === "save"}>
          Save
        </PillButton.Root>
        <PillButton.Root
          intent="neutral"
          className="bg-raised"
          onClick={() => setOpen(false)}
        >
          Cancel
        </PillButton.Root>
      </form>
      {owner ? (
        confirming ? (
          <p className="flex flex-wrap items-center gap-3">
            <span className="flex-1 text-[15px] font-semibold text-neg">
              Delete {name} and every app in it?
            </span>
            <PillButton.Root
              intent="neutral"
              onClick={() => setConfirming(false)}
            >
              Keep
            </PillButton.Root>
            <PillButton.Root
              intent="destructive"
              pending={pending === "delete"}
              onClick={() =>
                void act("delete", async () => {
                  const { orgs } = await import("../lib/api")
                  await orgs.remove(orgId)
                }).then(async (done) => {
                  if (done) {
                    await router.invalidate()
                    await router.navigate({ to: "/", search: {} })
                  }
                })
              }
            >
              Delete organization
            </PillButton.Root>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-fit cursor-pointer text-[15px] font-semibold text-neg underline underline-offset-[3px]"
          >
            Delete organization
          </button>
        )
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-[15px] font-medium text-neg">
          {error}
        </p>
      )}
      {stepUp.sheet}
    </section>
  )
}
