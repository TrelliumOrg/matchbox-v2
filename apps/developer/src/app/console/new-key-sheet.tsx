import type { EnvironmentSummary } from "@matchbox/contracts/console"
import * as PillButton from "@matchbox/ui/pill-button"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import * as Sheet from "@matchbox/ui/sheet"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { errorMessage } from "../lib/api-error"
import { CidrWarning, splitCidrs } from "./cidrs"
import { StepUpCancelledError, useStepUp } from "./step-up"

const expiries = { never: null, "30d": 30, "90d": 90, "1y": 365 } as const

type Expiry = keyof typeof expiries

function isExpiry(value: string): value is Expiry {
  return Object.hasOwn(expiries, value)
}

function expiresAt(expiry: Expiry, now: Date): string | null {
  const days = expiries[expiry]
  return days === null
    ? null
    : new Date(now.getTime() + days * 86_400_000).toISOString()
}

const inputClass =
  "h-12 w-full rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink outline-none focus:border-acc"

/** "New API key" (Dialogs `fwD_gUAY8l`): type, name, expiry, allowed IPs. */
export default function NewKeySheet({
  environment,
  onCreated,
  onClose,
}: {
  environment: EnvironmentSummary
  onCreated: (created: { name: string; key: string }) => void
  onClose: () => void
}): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const ids = { name: useId(), cidrs: useId() }
  const [open, setOpen] = useState(true)
  const [kind, setKind] = useState<"secret" | "publishable">("secret")
  const [name, setName] = useState("")
  const [expiry, setExpiry] = useState<Expiry>("never")
  const [cidrs, setCidrs] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const { environments } = await import("../lib/api")
      const allowedCidrs = kind === "secret" ? splitCidrs(cidrs) : []
      const created = await stepUp.run(() =>
        environments.createApiKey(environment.id, {
          kind,
          name,
          allowedCidrs,
          expiresAt: expiresAt(expiry, new Date()),
        }),
      )
      setOpen(false)
      onClose()
      onCreated({ name: created.apiKey.name, key: created.key })
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
          <Sheet.Header>New API key</Sheet.Header>
          <form onSubmit={(event) => void create(event)} className="contents">
            <Sheet.Body>
              <fieldset>
                <legend className="sr-only">Key</legend>
                <ol className="flex flex-col gap-6">
                  <li>
                    <p
                      className="mb-2 text-[15px] text-sec"
                      id={`${ids.name}-type`}
                    >
                      Type
                    </p>
                    <SegmentedControl.Root
                      aria-labelledby={`${ids.name}-type`}
                      value={kind}
                      onValueChange={(value) => {
                        if (value === "secret" || value === "publishable")
                          setKind(value)
                      }}
                    >
                      <SegmentedControl.Item value="secret">
                        Secret
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="publishable">
                        Publishable
                      </SegmentedControl.Item>
                    </SegmentedControl.Root>
                    <p className="mt-2 text-[14px] text-sec">
                      {kind === "secret"
                        ? "Server side only"
                        : "Browsers on allowed origins"}
                    </p>
                  </li>
                  <li className="flex flex-col gap-2">
                    <label htmlFor={ids.name} className="text-[15px] text-sec">
                      Name
                    </label>
                    <input
                      id={ids.name}
                      required
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className={inputClass}
                    />
                  </li>
                  <li>
                    <p
                      className="mb-2 text-[15px] text-sec"
                      id={`${ids.name}-expiry`}
                    >
                      Expires
                    </p>
                    <SegmentedControl.Root
                      aria-labelledby={`${ids.name}-expiry`}
                      value={expiry}
                      onValueChange={(value) => {
                        if (isExpiry(value)) setExpiry(value)
                      }}
                    >
                      <SegmentedControl.Item value="never">
                        Never
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="30d">
                        30d
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="90d">
                        90d
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="1y">
                        1y
                      </SegmentedControl.Item>
                    </SegmentedControl.Root>
                  </li>
                  {kind === "secret" ? (
                    <li className="flex flex-col gap-2">
                      <label
                        htmlFor={ids.cidrs}
                        className="flex justify-between text-[15px] text-sec"
                      >
                        Allowed IPs
                        <span className="text-mut">Optional</span>
                      </label>
                      <input
                        id={ids.cidrs}
                        value={cidrs}
                        placeholder="203.0.113.0/24"
                        onChange={(event) => setCidrs(event.target.value)}
                        className={`${inputClass} font-mono text-[15px] max-md:text-[16px]`}
                      />
                      <CidrWarning value={cidrs} />
                    </li>
                  ) : null}
                </ol>
              </fieldset>
              {error === null ? null : (
                <p
                  role="alert"
                  className="mt-5 text-[15px] font-medium text-neg"
                >
                  {error}
                </p>
              )}
            </Sheet.Body>
            <Sheet.Footer>
              <PillButton.Root type="submit" size="lg" pending={pending}>
                Create key
              </PillButton.Root>
            </Sheet.Footer>
          </form>
        </Sheet.Content>
      </Sheet.Root>
      {stepUp.sheet}
    </>
  )
}
