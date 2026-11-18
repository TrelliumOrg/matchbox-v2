import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as Sheet from "@matchbox/ui/sheet"
import { type ReactNode, useState } from "react"
import { errorMessage } from "../lib/api-error"
import GoogleButton from "./google-button"

/**
 * "Confirm with Google": a step-up credential for this session
 * (POST /api/auth/step-up/google, verified by the Worker against a nonce
 * bound to this browser). Dev step-up shows under `vite dev` only; the
 * server refuses it outside memory mode.
 */
export default function StepUpSheet({
  onCancel,
  onConfirmed,
}: {
  onCancel: () => void
  onConfirmed: () => void
}): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const [devPending, setDevPending] = useState(false)

  async function verify(credential: string): Promise<void> {
    const { auth } = await import("../lib/api")
    await auth.googleStepUp(credential)
    onConfirmed()
  }

  async function devStepUp(): Promise<void> {
    setDevPending(true)
    try {
      const { auth } = await import("../lib/api")
      await auth.devStepUp()
      onConfirmed()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setDevPending(false)
    }
  }

  return (
    <Sheet.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <Sheet.Content>
        <Sheet.Header>Confirm with Google</Sheet.Header>
        <Sheet.Body>
          <p className="flex items-center gap-3 text-[15.5px] text-sec">
            <span className="grid size-10 place-items-center rounded-full bg-soft text-ink">
              <Icon name="lock" size={17} strokeWidth={1.8} />
            </span>
            Valid for 10 min
          </p>
          {error === null ? null : (
            <p role="alert" className="mt-4 text-[15px] font-medium text-neg">
              {error}
            </p>
          )}
        </Sheet.Body>
        <Sheet.Footer>
          <GoogleButton
            purpose="step-up"
            onCredential={verify}
            onError={setError}
          />
          {import.meta.env.DEV ? (
            <PillButton.Root
              intent="secondary"
              size="lg"
              pending={devPending}
              onClick={() => void devStepUp()}
            >
              Dev step-up
            </PillButton.Root>
          ) : null}
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  )
}
