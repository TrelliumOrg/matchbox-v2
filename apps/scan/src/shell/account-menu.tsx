import { shortAddress } from "@matchbox/domain/format"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react"
import { openAppearance } from "./appearance"

/**
 * The account menu (`sVacxgPrc6`): the short address, Appearance, Matchbox
 * ID and Disconnect. Alerts arrive with watch lists (S5). The menu pattern:
 * focus starts on the first item, arrow keys, Home and End move between
 * items, Escape closes and returns focus to the trigger; a pick or a click
 * outside closes it too.
 */

const item =
  "flex h-12 w-full cursor-pointer items-center gap-3 rounded-[14px] px-3 text-left text-[16px] text-ink outline-none hover:bg-soft focus-visible:bg-soft focus-visible:outline-2 focus-visible:outline-ink"

function Row({
  icon,
  children,
}: {
  icon: GlyphShape
  children: ReactNode
}): ReactNode {
  return (
    <>
      <Glyph shape={icon} size={20} strokeWidth={1.8} />
      <span className="flex-1">{children}</span>
    </>
  )
}

export type CloseReason = "escape" | "pick" | "outside"

function items(menu: HTMLElement | null): HTMLElement[] {
  return menu === null
    ? []
    : [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")]
}

/** The item arrow keys, Home and End move to; null for other keys. */
export function nextItem(
  list: readonly HTMLElement[],
  key: string,
): HTMLElement | null {
  if (list.length === 0) return null
  const active = document.activeElement
  const at = active instanceof HTMLElement ? list.indexOf(active) : -1
  switch (key) {
    case "ArrowDown":
      return list[(at + 1) % list.length] ?? null
    case "ArrowUp":
      return list[(at - 1 + list.length) % list.length] ?? null
    case "Home":
      return list[0] ?? null
    case "End":
      return list[list.length - 1] ?? null
    default:
      return null
  }
}

export default function AccountMenu({
  address,
  onClose,
}: {
  address: string
  /** "escape" returns focus to the trigger; a pick or a click away does not. */
  onClose: (reason: CloseReason) => void
}): ReactNode {
  const menu = useRef<HTMLDivElement>(null)
  // The latest onClose, so the effects below run once per open: a parent
  // re-render must not move focus back to the first item.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    items(menu.current)[0]?.focus()
  }, [])

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (target instanceof Node && menu.current?.contains(target)) return
      if (target instanceof Element && target.closest("[aria-haspopup=menu]")) {
        return
      }
      close.current("outside")
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault()
      close.current("escape")
      return
    }
    const next = nextItem(items(menu.current), event.key)
    if (next === null) return
    event.preventDefault()
    next.focus()
  }

  async function disconnect(): Promise<void> {
    onClose("pick")
    const runtime = await import("@matchbox/wallet/runtime")
    await runtime.disconnectWallet(runtime.requireConfig())
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Account"
      onKeyDown={onKeyDown}
      className="absolute top-12 right-0 z-40 w-[320px] rounded-[20px] bg-raised p-2 shadow-pop max-xl:fixed max-xl:inset-x-3 max-xl:top-16 max-xl:w-auto"
    >
      <p className="border-b border-line px-3 pt-2 pb-3 font-mono text-[14.5px] text-ink2">
        {shortAddress(address)}
      </p>
      <div className="flex flex-col pt-2">
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onClose("pick")
            openAppearance()
          }}
        >
          <Row icon={shapes.sun}>Appearance</Row>
        </button>
        <a
          role="menuitem"
          href="https://id.matchbox.markets"
          target="_blank"
          rel="noreferrer noopener"
          className={item}
          onClick={() => onClose("pick")}
        >
          <Row icon={shapes.keyRound}>Matchbox ID</Row>
          <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2} />
        </a>
        <span aria-hidden="true" className="my-1.5 h-px bg-line" />
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => void disconnect()}
        >
          <Row icon={shapes.logOut}>Disconnect</Row>
        </button>
      </div>
    </div>
  )
}
