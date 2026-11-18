import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { errorMessage } from "../lib/api-error"
import { StepUpCancelledError, useStepUp } from "./step-up"

/**
 * An app without this environment (Classic's EnvironmentGate): creates it
 * with POST /api/apps/{appId}/environments/{kind}.
 */
export function CreateEnvironment({
  appId,
  kind,
}: {
  appId: string
  kind: "test" | "live"
}): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-start gap-4 rounded-[24px] border border-dashed border-dash p-8">
      <p className="text-[16px] font-medium text-ink">
        No {kind === "live" ? "live" : "test"} environment
      </p>
      <PillButton.Root
        pending={pending}
        onClick={async () => {
          setPending(true)
          setError(null)
          try {
            const { apps } = await import("../lib/api")
            await stepUp.run(() => apps.createEnvironment(appId, kind))
            await router.invalidate()
          } catch (caught) {
            if (!(caught instanceof StepUpCancelledError))
              setError(errorMessage(caught))
          } finally {
            setPending(false)
          }
        }}
      >
        Create {kind === "live" ? "live" : "test"} environment
      </PillButton.Root>
      {error === null ? null : (
        <p role="alert" className="text-[15px] font-medium text-neg">
          {error}
        </p>
      )}
      {stepUp.sheet}
    </div>
  )
}
