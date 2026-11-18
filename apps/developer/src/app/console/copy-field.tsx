import { Icon } from "@matchbox/ui/icons"
import { type ReactNode, useState } from "react"

/** A read-only mono value with a copy button (`Or71vVnUWj`). */
export function CopyField({
  label,
  value,
  shown = value,
}: {
  label: string
  value: string
  /** What the field shows, when it differs from what is copied. */
  shown?: string
}): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <span className="flex h-12 w-full max-w-[596px] items-center gap-3 rounded-[16px] border border-line bg-bg pr-2 pl-4">
      <span className="min-w-0 flex-1 truncate font-mono text-[15px] text-ink">
        {shown}
      </span>
      <button
        type="button"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }}
        className="grid size-9 flex-none cursor-pointer place-items-center rounded-full text-sec outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Icon name={copied ? "check" : "copy"} size={16} strokeWidth={1.8} />
      </button>
    </span>
  )
}
