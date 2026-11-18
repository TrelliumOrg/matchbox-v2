import * as PillButton from "@matchbox/ui/pill-button"
import * as Sheet from "@matchbox/ui/sheet"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { errorMessage } from "../lib/api-error"

/**
 * "New app" and its sheet: a name creates the app with a test and a live
 * environment (POST /api/orgs/{orgId}/apps), then opens it.
 */
export default function NewAppSheet({
  orgId,
  onClose,
}: {
  orgId: string
  onClose: () => void
}): ReactNode {
  const router = useRouter()
  const nameId = useId()
  const [open, setOpen] = useState(true)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const { orgs } = await import("../lib/api")
      const app = await orgs.createApp(orgId, { name })
      setOpen(false)
      onClose()
      await router.invalidate()
      await router.navigate({
        to: "/apps/$appId",
        params: { appId: app.id },
        search: (current) =>
          current.org === undefined ? {} : { org: current.org },
      })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onClose()
      }}
    >
      <Sheet.Content>
        <Sheet.Header>New app</Sheet.Header>
        <form onSubmit={(event) => void create(event)} className="contents">
          <Sheet.Body>
            <fieldset>
              <legend className="sr-only">App</legend>
              <ol>
                <li className="flex flex-col gap-2">
                  <label htmlFor={nameId} className="text-[15px] text-sec">
                    Name
                  </label>
                  <input
                    id={nameId}
                    required
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-12 rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink outline-none focus:border-acc"
                  />
                </li>
              </ol>
            </fieldset>
            <p className="mt-4 text-[14.5px] text-sec">
              Test and live environments
            </p>
            {error === null ? null : (
              <p role="alert" className="mt-4 text-[15px] font-medium text-neg">
                {error}
              </p>
            )}
          </Sheet.Body>
          <Sheet.Footer>
            <PillButton.Root type="submit" size="lg" pending={pending}>
              Create app
            </PillButton.Root>
          </Sheet.Footer>
        </form>
      </Sheet.Content>
    </Sheet.Root>
  )
}
