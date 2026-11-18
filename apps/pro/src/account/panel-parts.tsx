import { Glyph, shapes } from "@matchbox/ui/icons"
import { Dialog } from "radix-ui"
import { type ReactNode, useEffect, useRef, useState } from "react"

/** Pieces shared by the Account panel's views. */

export const roundClass =
  "grid size-10 flex-none cursor-pointer place-items-center rounded-full bg-soft text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink dark:bg-soft2"

/** A sub view's header: back, title, close (frame `nfGe_W-agZ`). */
export function ViewHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}): ReactNode {
  return (
    <header className="flex h-11 flex-none items-center gap-3 px-7 pt-7 max-sm:px-6 max-sm:pt-4">
      <button
        type="button"
        aria-label="Back to account"
        onClick={onBack}
        className={`${roundClass} -ml-1`}
      >
        <Glyph shape={shapes.chevronLeft} size={20} strokeWidth={1.8} />
      </button>
      <Dialog.Title className="text-[22px] font-[650] tracking-[-0.02em]">
        {title}
      </Dialog.Title>
      <Dialog.Close aria-label="Close" className={`${roundClass} ml-auto`}>
        <Glyph shape={shapes.x} size={20} strokeWidth={1.8} />
      </Dialog.Close>
    </header>
  )
}

/** One async load for a view, rerun when `key` changes. */
export function useLoad<T>(
  key: string,
  load: () => Promise<T>,
): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{
    key: string
    data: T | null
    failed: boolean
  }>({ key, data: null, failed: false })
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names the load
  useEffect(() => {
    let live = true
    load().then(
      (data) => {
        if (live) setState({ key, data, failed: false })
      },
      () => {
        if (live) setState({ key, data: null, failed: true })
      },
    )
    return () => {
      live = false
    }
  }, [key])
  return state.key === key
    ? { data: state.data, failed: state.failed }
    : { data: null, failed: false }
}

/** Copies text; `copied` names what was copied for 1.6s. */
export function useCopy(): {
  copied: string | null
  copy: (id: string, text: string) => void
} {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  function copy(id: string, text: string): void {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(id)
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(null), 1600)
      },
      () => setCopied(null),
    )
  }
  return { copied, copy }
}

/** A radio choice card (Network, Signing). */
export function Choice({
  name,
  value,
  checked,
  onSelect,
  title,
  detail,
}: {
  name: string
  value: string
  checked: boolean
  onSelect: () => void
  title: string
  detail: string
}): ReactNode {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3.5 rounded-[20px] bg-soft px-[18px] py-4 dark:bg-soft2 ${checked ? "shadow-[inset_0_0_0_2px_var(--acc)]" : ""}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-5 flex-none cursor-pointer accent-[var(--acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      />
      <span className="min-w-0">
        <span className="block text-base font-semibold">{title}</span>
        <span className="mt-0.5 block text-[14.5px] text-sec">{detail}</span>
      </span>
    </label>
  )
}

/** A text field in a soft box: label, input, an action and a status line. */
export function TextBox({
  id,
  label,
  value,
  onValueChange,
  placeholder,
  action,
  status,
}: {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  action?: ReactNode
  status?: { tone: "positive" | "negative" | "muted"; text: string } | null
}): ReactNode {
  const tone =
    status?.tone === "positive"
      ? "text-pos"
      : status?.tone === "negative"
        ? "text-neg"
        : "text-sec"
  return (
    <div className="rounded-[20px] bg-soft px-[18px] py-4 dark:bg-soft2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[14.5px] text-sec">
          {label}
        </label>
        {action}
      </div>
      <input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-describedby={
          status === null || status === undefined ? undefined : `${id}-status`
        }
        className="mt-2 w-full bg-transparent font-mono text-[15.5px] text-ink outline-none placeholder:text-mut"
      />
      {status === null || status === undefined ? null : (
        <p
          id={`${id}-status`}
          aria-live="polite"
          className={`mt-2 flex items-center gap-1.5 text-[14px] tabular-nums ${tone}`}
        >
          {status.tone === "positive" ? (
            <Glyph
              shape={shapes.check}
              size={16}
              strokeWidth={2.2}
              className="mbx-draw"
            />
          ) : null}
          {status.text}
        </p>
      )}
    </div>
  )
}

export const textActionClass =
  "cursor-pointer text-[14.5px] font-semibold text-acc-ink outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50"
