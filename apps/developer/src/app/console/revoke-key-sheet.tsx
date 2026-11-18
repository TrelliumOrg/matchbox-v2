import type { ApiKeyRecord } from "@matchbox/contracts/console"
import * as PillButton from "@matchbox/ui/pill-button"
import * as Sheet from "@matchbox/ui/sheet"
import { useRouter } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { errorMessage } from "../lib/api-error"
import { shortDate } from "../lib/numbers"
import { StepUpCancelledError, useStepUp } from "./step-up"

/** "Revoke key?": stops within seconds, cannot be undone. */
export default function RevokeKeySheet({
  apiKey,
  onClose,
}: {
  apiKey: ApiKeyRecord
  onClose: () => void
}): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const [open, setOpen] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function revoke(): Promise<void> {
    setPending(true)
    setError(null)
    try {
      const { apiKeys } = await import("../lib/api")
      await stepUp.run(() => apiKeys.revoke(apiKey.id))
      setOpen(false)
      onClose()
      await router.invalidate()
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Sheet.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onClose()
        }}
      >
        <Sheet.Content>
          <Sheet.Header>Revoke key?</Sheet.Header>
          <Sheet.Body>
            <p className="font-mono text-[14.5px] text-ink">
              {apiKey.displayPrefix}
            </p>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[20px] bg-soft p-4 text-[15px]">
              <dt className="text-sec">Name</dt>
              <dd className="text-right font-medium text-ink">{apiKey.name}</dd>
              <dt className="text-sec">Last used</dt>
              <dd className="text-right font-medium text-ink">
                {apiKey.lastUsedAt === null
                  ? "Never"
                  : shortDate(apiKey.lastUsedAt)}
              </dd>
            </dl>
            {error === null ? null : (
              <p role="alert" className="mt-4 text-[15px] font-medium text-neg">
                {error}
              </p>
            )}
          </Sheet.Body>
          <Sheet.Footer>
            <PillButton.Root
              intent="destructive"
              size="lg"
              pending={pending}
              onClick={() => void revoke()}
            >
              Revoke
            </PillButton.Root>
          </Sheet.Footer>
        </Sheet.Content>
      </Sheet.Root>
      {stepUp.sheet}
    </>
  )
}
