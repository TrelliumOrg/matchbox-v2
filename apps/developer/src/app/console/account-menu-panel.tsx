import type { MeResponse } from "@matchbox/contracts/console"
import * as Theme from "@matchbox/ui/theme"
import * as Tooltip from "@matchbox/ui/tooltip"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef } from "react"
import { Glyph } from "./glyphs"

const item =
  "flex h-12 w-full cursor-pointer items-center gap-3 rounded-[14px] px-2 text-left text-[16px] font-medium text-ink outline-none hover:bg-soft focus-visible:bg-soft focus-visible:outline-2 focus-visible:outline-ink"

/**
 * The account menu's panel (`KXelB7l7UL`), loaded when the menu first
 * opens so the theme switch (Radix) never ships with the page. Escape and a
 * click outside close it and return focus to the button.
 */
export default function AccountMenuPanel({
  me,
  onClose,
  onSignOut,
  signingOut,
}: {
  me: MeResponse
  onClose: (restoreFocus: boolean) => void
  onSignOut: () => void
  signingOut: boolean
}): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const { appearance } = Theme.useTheme()

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("a,button")?.focus()
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose(true)
    }
    function onPointer(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panel.current?.parentElement?.contains(target)) return
      onClose(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [onClose])

  return (
    <div
      ref={panel}
      className="absolute top-[calc(100%+8px)] right-0 z-30 w-80 rounded-[24px] bg-raised p-3 shadow-lift"
    >
      <p className="border-b border-line px-2 pt-1 pb-3">
        <span className="block truncate text-[16px] font-semibold text-ink">
          {me.account.displayName}
        </span>
        <span className="block truncate text-[14px] text-sec">
          {me.account.email}
        </span>
      </p>
      <div className="mt-2 flex h-12 items-center gap-3 px-2">
        <Glyph name="palette" size={19} />
        <span className="flex-1 text-[16px] font-medium text-ink">Theme</span>
        <Tooltip.Provider>
          <Theme.QuickSwitch />
        </Tooltip.Provider>
      </div>
      <Link
        to="/account"
        search={(current: { org?: string }) =>
          current.org === undefined ? {} : { org: current.org }
        }
        onClick={() => onClose(false)}
        className={item}
      >
        <Glyph name="palette" size={19} />
        <span className="flex-1">Appearance</span>
        <span className="text-[14.5px] font-normal text-sec capitalize">
          {appearance.mode === "dark" ? appearance.dark : appearance.light}
        </span>
        <Glyph name="chevron-right" size={16} />
      </Link>
      <Link
        to="/account"
        search={(current: { org?: string }) =>
          current.org === undefined ? {} : { org: current.org }
        }
        onClick={() => onClose(false)}
        className={item}
      >
        <Glyph name="user" size={19} />
        Account
      </Link>
      <div className="mt-1 border-t border-line pt-1">
        <button
          type="button"
          disabled={signingOut}
          onClick={onSignOut}
          className={item}
        >
          <Glyph name="log-out" size={19} />
          Sign out
        </button>
      </div>
    </div>
  )
}
