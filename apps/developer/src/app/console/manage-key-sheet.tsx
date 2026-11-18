import type { ApiKeyRecord } from "@matchbox/contracts/console"
import * as PillButton from "@matchbox/ui/pill-button"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import * as Sheet from "@matchbox/ui/sheet"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { errorMessage } from "../lib/api-error"
import { CidrWarning, splitCidrs } from "./cidrs"
import { StepUpCancelledError, useStepUp } from "./step-up"

const overlaps = {
  now: 0,
  "1h": 3_600,
  "24h": 86_400,
  "7d": 604_800,
} as const

type Overlap = keyof typeof overlaps

function isOverlap(value: string): value is Overlap {
  return Object.hasOwn(overlaps, value)
}

/** Classic's key expiry choices (lib/api-keys `expiryChoices`). */
const expiryDays = { "30d": 30, "90d": 90, "365d": 365 } as const
const expiryLabels = { "30d": "30 d", "90d": "90 d", "365d": "1 y" } as const
const dayMs = 86_400_000

type ExpiryEdit = "keep" | keyof typeof expiryDays | "now"

function isExpiryEdit(value: string): value is ExpiryEdit {
  return value === "keep" || value === "now" || value in expiryDays
}

/** The new expiry to send, or null to keep the key's. */
export function expiryAt(edit: ExpiryEdit, now: number): string | null {
  if (edit === "keep") return null
  if (edit === "now") return new Date(now).toISOString()
  return new Date(now + expiryDays[edit] * dayMs).toISOString()
}

const expiryDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

/**
 * A key's sheet (`WXZBHwQdbF`, rotate in Dialogs `fwD_gUAY8l`): rename,
 * allowed IPs for secret keys, and rotation with an overlap during which the
 * old key keeps working. The new key goes to `onRotated` and is shown once.
 */
export default function ManageKeySheet({
  apiKey,
  onRotated,
  onClose,
}: {
  apiKey: ApiKeyRecord
  onRotated: (created: { name: string; key: string }) => void
  onClose: () => void
}): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const ids = {
    name: useId(),
    cidrs: useId(),
    overlap: useId(),
    expiry: useId(),
  }
  const [open, setOpen] = useState(true)
  const [name, setName] = useState(apiKey.name)
  const [cidrs, setCidrs] = useState(apiKey.allowedCidrs.join(", "))
  const [overlap, setOverlap] = useState<Overlap>("24h")
  const [expiry, setExpiry] = useState<ExpiryEdit>("keep")
  const [pending, setPending] = useState<"save" | "rotate" | null>(null)
  const [error, setError] = useState<string | null>(null)

  function close(): void {
    setOpen(false)
    onClose()
  }

  async function act(
    kind: "save" | "rotate",
    action: () => Promise<void>,
  ): Promise<void> {
    setPending(kind)
    setError(null)
    try {
      await stepUp.run(action)
      await router.invalidate()
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    void act("save", async () => {
      const { apiKeys } = await import("../lib/api")
      const allowedCidrs = splitCidrs(cidrs)
      await apiKeys.update(apiKey.id, {
        name,
        ...(apiKey.kind === "secret" ? { allowedCidrs } : {}),
      })
      const at = expiryAt(expiry, Date.now())
      if (at !== null) await apiKeys.expire(apiKey.id, at)
      close()
    })
  }

  function rotate(): void {
    void act("rotate", async () => {
      const { apiKeys } = await import("../lib/api")
      const rotated = await apiKeys.rotate(apiKey.id, overlaps[overlap])
      close()
      onRotated({ name: rotated.apiKey.name, key: rotated.key })
    })
  }

  const inputClass =
    "h-12 w-full rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink outline-none focus:border-acc"

  return (
    <>
      <Sheet.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <Sheet.Content>
          <Sheet.Header>{apiKey.name}</Sheet.Header>
          <form onSubmit={save} className="contents">
            <Sheet.Body>
              <p className="mb-6 rounded-[18px] bg-soft px-4 py-3 font-mono text-[14px] text-ink">
                {apiKey.displayPrefix}
              </p>
              <fieldset>
                <legend className="sr-only">Key</legend>
                <ol className="flex flex-col gap-6">
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
                  {apiKey.kind === "secret" ? (
                    <li className="flex flex-col gap-2">
                      <label
                        htmlFor={ids.cidrs}
                        className="text-[15px] text-sec"
                      >
                        Allowed IPs
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
                  <li className="flex flex-col gap-2">
                    <label
                      htmlFor={ids.expiry}
                      className="text-[15px] text-sec"
                    >
                      Expires
                    </label>
                    <select
                      id={ids.expiry}
                      value={expiry}
                      onChange={(event) => {
                        if (isExpiryEdit(event.target.value))
                          setExpiry(event.target.value)
                      }}
                      className={inputClass}
                    >
                      <option value="keep">
                        {apiKey.expiresAt === null
                          ? "Never"
                          : expiryDate.format(new Date(apiKey.expiresAt))}
                      </option>
                      {(["30d", "90d", "365d"] as const).map((choice) => (
                        <option key={choice} value={choice}>
                          {expiryLabels[choice]},{" "}
                          {expiryDate.format(
                            new Date(Date.now() + expiryDays[choice] * dayMs),
                          )}
                        </option>
                      ))}
                      <option value="now">Expire now</option>
                    </select>
                  </li>
                  <li>
                    <p id={ids.overlap} className="mb-2 text-[15px] text-sec">
                      Old key expires after rotation
                    </p>
                    <SegmentedControl.Root
                      aria-labelledby={ids.overlap}
                      value={overlap}
                      onValueChange={(value) => {
                        if (isOverlap(value)) setOverlap(value)
                      }}
                    >
                      <SegmentedControl.Item value="now">
                        Immediately
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="1h">
                        1h
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="24h">
                        24h
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="7d">
                        7d
                      </SegmentedControl.Item>
                    </SegmentedControl.Root>
                  </li>
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
              <span className="grid grid-cols-2 gap-3">
                <PillButton.Root
                  intent="neutral"
                  size="lg"
                  className="bg-soft"
                  pending={pending === "rotate"}
                  onClick={rotate}
                >
                  Rotate
                </PillButton.Root>
                <PillButton.Root
                  type="submit"
                  size="lg"
                  pending={pending === "save"}
                >
                  Save
                </PillButton.Root>
              </span>
            </Sheet.Footer>
          </form>
        </Sheet.Content>
      </Sheet.Root>
      {stepUp.sheet}
    </>
  )
}
