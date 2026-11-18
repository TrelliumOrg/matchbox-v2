import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as Sheet from "@matchbox/ui/sheet"
import { type ReactNode, useEffect, useId, useState } from "react"

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * The full key or secret, shown exactly once ("Key created" in the Dialogs
 * frame). It lives only in component state and is dropped on Done; Done
 * waits for "Stored securely".
 */
export default function ShownOnce({
  title,
  name,
  secret,
  envName,
  onDone,
}: {
  title: string
  name: string
  secret: string | null
  envName: string
  onDone: () => void
}): ReactNode {
  const storedId = useId()
  const [stored, setStored] = useState(false)
  const [copied, setCopied] = useState<"key" | "env" | null>(null)

  useEffect(() => {
    if (secret !== null) {
      setStored(false)
      setCopied(null)
    }
  }, [secret])

  async function copyAs(kind: "key" | "env"): Promise<void> {
    if (secret === null) return
    const text = kind === "key" ? secret : `${envName}=${secret}`
    if (await copy(text)) setCopied(kind)
  }

  return (
    <Sheet.Root
      open={secret !== null}
      onOpenChange={(open) => {
        if (!open && stored) onDone()
      }}
    >
      <Sheet.Content
        data-feedback="no-capture"
        data-feedback-reason="It shows a secret key"
      >
        <Sheet.Header>{title}</Sheet.Header>
        <Sheet.Body>
          <p className="flex items-center gap-3 text-[16px] font-semibold text-ink">
            <span className="grid size-10 place-items-center rounded-full bg-pos-soft text-pos">
              <Icon name="check" size={18} strokeWidth={2.2} />
            </span>
            {name}
          </p>
          <p className="mt-5 rounded-[18px] bg-soft px-4 py-3 text-[15px] font-medium text-ink">
            Shown once
          </p>
          <p className="mt-3 rounded-[18px] border border-line p-4 font-mono text-[14px] break-all text-ink">
            {secret}
          </p>
          <p className="mt-4 flex flex-wrap gap-2">
            <PillButton.Root
              intent="secondary"
              size="sm"
              onClick={() => void copyAs("key")}
            >
              <Icon name={copied === "key" ? "check" : "copy"} size={15} />
              {copied === "key" ? "Copied" : "Copy key"}
            </PillButton.Root>
            <PillButton.Root
              intent="neutral"
              size="sm"
              className="bg-soft"
              onClick={() => void copyAs("env")}
            >
              <Icon name={copied === "env" ? "check" : "copy"} size={15} />
              {copied === "env" ? "Copied" : "Copy as .env"}
            </PillButton.Root>
          </p>
          <p className="mt-6 flex items-center gap-3">
            <input
              id={storedId}
              type="checkbox"
              checked={stored}
              onChange={(event) => setStored(event.target.checked)}
              className="size-5 accent-[var(--acc)]"
            />
            <label htmlFor={storedId} className="text-[15.5px] text-ink">
              Stored securely
            </label>
          </p>
        </Sheet.Body>
        <Sheet.Footer>
          <PillButton.Root size="lg" disabled={!stored} onClick={onDone}>
            Done
          </PillButton.Root>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  )
}
