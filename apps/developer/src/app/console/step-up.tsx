import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useRef,
  useState,
} from "react"
import { ApiError } from "../lib/api-error"

const StepUpSheet = lazy(() => import("./step-up-sheet"))

/** Thrown when the user closes the confirmation instead of confirming. */
export class StepUpCancelledError extends Error {
  constructor() {
    super("Confirmation cancelled")
    this.name = "StepUpCancelledError"
  }
}

type Pending = { resolve: () => void; reject: (error: Error) => void }

/**
 * Sensitive writes (live secret keys, client secrets, rotation) need a
 * fresh Google confirmation: the server answers 403 `step_up_required`.
 * `run` retries the action once after the user confirms in the sheet
 * ("Confirm with Google", Dialogs `fwD_gUAY8l`). The server decides when a
 * step-up is needed; this only asks and retries. The sheet and the Google
 * button load only when asked for.
 */
export function useStepUp(): {
  run: <T>(action: () => Promise<T>) => Promise<T>
  sheet: ReactNode
} {
  const [open, setOpen] = useState(false)
  const pending = useRef<Pending | null>(null)

  const confirm = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current?.reject(new StepUpCancelledError())
        pending.current = { resolve, reject }
        setOpen(true)
      }),
    [],
  )

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action()
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "step_up_required") {
          throw error
        }
        await confirm()
        return action()
      }
    },
    [confirm],
  )

  function cancel(): void {
    setOpen(false)
    pending.current?.reject(new StepUpCancelledError())
    pending.current = null
  }

  function confirmed(): void {
    pending.current?.resolve()
    pending.current = null
    setOpen(false)
  }

  const sheet = open ? (
    <Suspense fallback={null}>
      <StepUpSheet onCancel={cancel} onConfirmed={confirmed} />
    </Suspense>
  ) : null

  return { run, sheet }
}
