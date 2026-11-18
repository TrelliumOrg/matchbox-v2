import type { ReactNode } from "react"
import { Glyph, type GlyphShape, Spinner, shapes } from "../icons"
import { tv } from "../tv"

/**
 * Status chip. Only real state, never decoration (matchbox-v3): a
 * transaction's Success or Failed, a block's Finalized, a position's Active
 * or Repaid. `inline` is the table form (icon and word in the tone's
 * colour), `chip` the soft pill beside a title. The word is always shown, so
 * colour never carries the meaning alone.
 *
 * On a chip the word is ink and only the icon takes the tone: pos on posSoft
 * is 3.5:1 and neg on negSoft 3.7:1 in the light presets, under AA for text
 * but enough for an icon (3:1). `statusColors` names every pair, and a test
 * checks each against every preset in themes.css.
 */

export type Tone = "positive" | "negative" | "pending" | "neutral"
export type Variant = "inline" | "chip"

/** Token names (`--pos`) for each part, per variant and tone. */
export const statusColors: Record<
  Variant,
  Record<Tone, { text: string; icon: string; background: readonly string[] }>
> = {
  inline: {
    // Inline sits on the page or on a soft card.
    positive: { text: "pos", icon: "pos", background: ["bg", "soft"] },
    negative: { text: "neg", icon: "neg", background: ["bg", "soft"] },
    pending: { text: "ink2", icon: "ink2", background: ["bg", "soft"] },
    neutral: { text: "ink2", icon: "ink2", background: ["bg", "soft"] },
  },
  chip: {
    positive: { text: "ink", icon: "pos", background: ["posSoft"] },
    negative: { text: "ink", icon: "neg", background: ["negSoft"] },
    pending: { text: "ink2", icon: "ink2", background: ["soft"] },
    neutral: { text: "ink2", icon: "ink2", background: ["soft"] },
  },
}

const chip = tv({
  base: "inline-flex items-center gap-1.5 whitespace-nowrap font-semibold",
  variants: {
    variant: {
      inline: "text-[15px]",
      chip: "h-7 rounded-[14px] px-2.5 text-[13.5px]",
    },
    tone: {
      positive: "text-pos",
      negative: "text-neg",
      pending: "text-ink2",
      neutral: "text-ink2",
    },
  },
  compoundVariants: [
    { variant: "chip", tone: "positive", class: "bg-pos-soft text-ink" },
    { variant: "chip", tone: "negative", class: "bg-neg-soft text-ink" },
    { variant: "chip", tone: "pending", class: "bg-soft" },
    { variant: "chip", tone: "neutral", class: "bg-soft" },
  ],
  defaultVariants: { variant: "inline", tone: "neutral" },
})

const icons: Record<Tone, GlyphShape | null> = {
  positive: shapes.check,
  negative: shapes.x,
  pending: null,
  neutral: null,
}

const iconTone: Record<Tone, string> = {
  positive: "text-pos",
  negative: "text-neg",
  pending: "text-ink2",
  neutral: "text-ink2",
}

export type RootProps = {
  tone: Tone
  variant?: Variant
  /** The state in one word: "Success", "Failed", "Finalized", "Pending". */
  children: string
  className?: string
}

export function Root({
  tone,
  variant = "inline",
  children,
  className,
}: RootProps): ReactNode {
  const icon = icons[tone]
  return (
    <span className={chip({ tone, variant, className })}>
      {tone === "pending" ? (
        <Spinner size={13} className={iconTone[tone]} />
      ) : icon === null ? null : (
        <Glyph
          shape={icon}
          size={14}
          strokeWidth={2.4}
          className={iconTone[tone]}
        />
      )}
      {children}
    </span>
  )
}

/** A transaction's status from the chain: 1 succeeded, 0 reverted. */
export function txTone(status: "success" | "failed" | "pending"): Tone {
  if (status === "success") return "positive"
  if (status === "failed") return "negative"
  return "pending"
}

Root.displayName = "StatusChip.Root"
