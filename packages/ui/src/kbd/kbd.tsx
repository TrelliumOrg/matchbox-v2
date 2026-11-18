import type { ReactNode } from "react"

/**
 * Keyboard shortcut hint as key caps: `<Kbd keys={["mod", "k"]} />` shows
 * ⌘ K on macOS and iOS and ctrl K elsewhere. "mod" follows the platform
 * the server stamped on `<html data-platform>` (see ./platform): both caps
 * are rendered and CSS shows one, so nothing swaps after paint. The two mod
 * caps share a width.
 *
 * Keys: "mod", "ctrl", "shift", "alt", "enter", "esc", "up", "down", or a
 * single character ("k", "/").
 */

export type KbdKey =
  | "mod"
  | "ctrl"
  | "shift"
  | "alt"
  | "enter"
  | "esc"
  | "up"
  | "down"
  | (string & {})

export type KbdProps = {
  keys: readonly KbdKey[]
  className?: string
}

const cap =
  "inline-grid h-[22px] min-w-[22px] place-items-center rounded-md bg-raised px-1.5 font-sans text-[12px] leading-none font-semibold text-sec shadow-[inset_0_0_0_1px_var(--line),inset_0_-1px_0_var(--line)]"

function CommandGlyph(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
    </svg>
  )
}

const spoken: Record<string, string> = {
  ctrl: "Control",
  shift: "Shift",
  alt: "Alt",
  enter: "Enter",
  esc: "Escape",
  up: "Up arrow",
  down: "Down arrow",
}

const shown: Record<string, ReactNode> = {
  ctrl: "ctrl",
  shift: "shift",
  alt: "alt",
  enter: "enter",
  esc: "esc",
  up: "↑",
  down: "↓",
}

function Cap({ name }: { name: string }): ReactNode {
  return (
    <kbd className={cap} aria-label={spoken[name] ?? name.toUpperCase()}>
      {shown[name] ?? name.toUpperCase()}
    </kbd>
  )
}

function ModCap(): ReactNode {
  return (
    <>
      <kbd
        data-kbd-platform="mac"
        className={`${cap} min-w-[34px]`}
        aria-label="Command"
      >
        <CommandGlyph />
      </kbd>
      <kbd
        data-kbd-platform="other"
        className={`${cap} min-w-[34px]`}
        aria-label="Control"
      >
        ctrl
      </kbd>
    </>
  )
}

export function Kbd({ keys, className }: KbdProps): ReactNode {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      {keys.map((key, index) =>
        key === "mod" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: keys are a fixed sequence
          <ModCap key={index} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: keys are a fixed sequence
          <Cap key={index} name={key} />
        ),
      )}
    </span>
  )
}

Kbd.displayName = "Kbd"
