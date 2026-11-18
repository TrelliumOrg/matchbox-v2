import { addressAvatar, shortAddress } from "@matchbox/domain/format"
import * as Avatar from "@matchbox/ui/avatar"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import { Kbd } from "@matchbox/ui/kbd"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import type { ReactNode } from "react"
import type { MezoIdMatch } from "../data/mezo-id"

/**
 * One palette result (`geYXFRMGVg`): a round lead (a kind's glyph, or a
 * wallet's avatar), the title with its tag, the detail in DM Mono, and
 * the Enter key cap on the active row.
 */

export type Group = "gauges" | "addresses" | "transactions" | "jump"

/** A row in the palette, from the query's shape, our API or Blockscout. */
export type Option = {
  key: string
  path: string
  title: string
  detail: string
  lead:
    | { kind: "glyph"; shape: GlyphShape }
    | { kind: "avatar"; initials: string; hue: number }
  /** A property of the title shown as its icon: a Mezo ID's key. */
  mark: "mezo-id" | null
  /** Label and chain names: rendered as untrusted text. */
  untrusted: boolean
  /** A label's tag or a token's symbol, shown as a chip. */
  tag: string | null
  group: Group
}

/**
 * A Mezo ID's wallets, or a Bitcoin address's EVM address, as rows under
 * Addresses, the account's own wallet first. Titled by the ID where the
 * wallet has one, else by its address.
 */
export function mezoIdOptions(match: MezoIdMatch | null): Option[] {
  if (match === null) return []
  const id = match.mezoId
  return match.wallets.map((wallet) => ({
    key: `mezo-id:${wallet}`,
    path: `/address/${wallet}`,
    title: id ?? shortAddress(wallet),
    detail: shortAddress(wallet),
    lead: { kind: "avatar", ...addressAvatar(wallet) },
    mark: id === null ? null : "mezo-id",
    // The ID passed our shape check; the address is hex.
    untrusted: false,
    tag: null,
    group: "addresses",
  }))
}

export function PaletteRow({
  option,
  id,
  active,
  onActivate,
  onChoose,
}: {
  option: Option
  id: string
  active: boolean
  onActivate: () => void
  onChoose: () => void
}): ReactNode {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the input owns the keys (aria-activedescendant)
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onPointerMove={onActivate}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onChoose}
      className={`flex h-[58px] cursor-pointer items-center gap-3.5 rounded-2xl px-3.5 ${active ? "bg-soft" : ""}`}
    >
      {option.lead.kind === "avatar" ? (
        <Avatar.Root
          initials={option.lead.initials}
          hue={option.lead.hue}
          size={40}
        />
      ) : (
        <span className="grid size-10 flex-none place-items-center rounded-full bg-soft2 text-ink2">
          <Glyph shape={option.lead.shape} size={18} strokeWidth={1.8} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[16px] font-semibold">
            {option.untrusted ? (
              <UntrustedText.Root value={option.title} limit={48} />
            ) : (
              option.title
            )}
          </span>
          {option.mark === "mezo-id" ? (
            <span
              role="img"
              aria-label="Mezo ID"
              title="Mezo ID"
              className="flex-none text-sec"
            >
              <Glyph shape={shapes.keyRound} size={16} strokeWidth={1.75} />
            </span>
          ) : null}
          {option.tag === null ? null : (
            <span className="flex-none rounded-md bg-soft2 px-1.5 py-0.5 text-[13px] text-ink2">
              <UntrustedText.Root value={option.tag} limit={20} />
            </span>
          )}
        </span>
        <span className="truncate font-mono text-[14px] text-sec">
          {option.untrusted ? (
            <UntrustedText.Root value={option.detail} limit={48} />
          ) : (
            option.detail
          )}
        </span>
      </span>
      {active ? (
        <span className="hidden [@media(pointer:fine)]:contents">
          <Kbd keys={["enter"]} />
        </span>
      ) : null}
    </div>
  )
}
