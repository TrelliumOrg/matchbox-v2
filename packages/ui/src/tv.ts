/**
 * A small `tv` in place of tailwind-variants, whose class-merging engine
 * alone was 16 kB of every route's first-paint JS. Components still resolve
 * conflicts (a variant's `bg-soft` beats the base `bg-acc`, a
 * caller's `className` beats both) through `mergeClasses`, which knows the
 * utility groups this design system uses. The last class in a group wins,
 * per variant prefix, as in tailwind-merge.
 */

const groups: readonly (readonly [RegExp, string])[] = [
  [/^(bg)-/, "bg"],
  [/^text-(xs|sm|base|lg|xl|\dxl|\[\d*\.?\d+(px|rem|em)\])$/, "text-size"],
  [/^text-(left|center|right|justify|start|end)$/, "text-align"],
  [/^text-/, "text-color"],
  [/^font-(sans|mono|serif)$/, "font-family"],
  [/^font-/, "font-weight"],
  [/^(size)-/, "size"],
  [/^(min-w|max-w|min-h|max-h|w|h)-/, "$1"],
  [/^(p|px|py|pt|pr|pb|pl|ps|pe)-/, "$1"],
  [/^-?(m|mx|my|mt|mr|mb|ml|ms|me)-/, "$1"],
  // Longest first: "gap" alone would also match "gap-x-3".
  [/^(gap-x|gap-y|gap)-/, "$1"],
  [/^rounded(-[tblr]{1,2})?(-|$)/, "rounded$1"],
  [/^shadow(-|$)/, "shadow"],
  [/^border-(\d|\[\d)/, "border-width"],
  [/^border-(solid|dashed|dotted|none)$/, "border-style"],
  [/^border-/, "border-color"],
  [
    /^(opacity|z|cursor|leading|tracking|whitespace|overflow|duration|ease|animate|self|justify|items|origin)-/,
    "$1",
  ],
  [/^(flex-row|flex-col|flex-row-reverse|flex-col-reverse)$/, "flex-direction"],
  [
    /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents)$/,
    "display",
  ],
  [/^(static|fixed|absolute|relative|sticky)$/, "position"],
  [/^-?(inset-x|inset-y|inset|top|right|bottom|left)-/, "$1"],
  [/^(outline)-(\d|none|\[\d)/, "outline-width"],
  [/^(outline)-/, "outline-color"],
]

function groupOf(utility: string): string | null {
  const bare = utility.startsWith("!") ? utility.slice(1) : utility
  for (const [pattern, key] of groups) {
    const match = pattern.exec(bare)
    if (match !== null) return key.replace("$1", match[1] ?? "")
  }
  return null
}

/** Splits "hover:dark:bg-soft" into its variant prefix and utility. */
function splitVariant(token: string): [string, string] {
  let depth = 0
  let cut = -1
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]
    if (char === "[") depth += 1
    else if (char === "]") depth -= 1
    else if (char === ":" && depth === 0) cut = index
  }
  return cut === -1
    ? ["", token]
    : [token.slice(0, cut + 1), token.slice(cut + 1)]
}

export function mergeClasses(classes: string): string {
  const tokens = classes.split(/\s+/).filter(Boolean)
  const seen = new Set<string>()
  const kept: string[] = []
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index] ?? ""
    const [variant, utility] = splitVariant(token)
    const group = groupOf(utility)
    const key = group === null ? `=${token}` : `${variant}${group}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(token)
  }
  return kept.reverse().join(" ")
}

type BooleanKey<T> = T extends "true" | "false" ? boolean : T

/** Variant name to chosen value ("true" and "false" keys accept booleans). */
type Selection<V> = { [K in keyof V]?: BooleanKey<keyof V[K]> | undefined }

type SlotVariants<S extends string> = Record<
  string,
  Record<string, Partial<Record<S, string>>>
>

type BaseVariants = Record<string, Record<string, string>>

type ClassName = { className?: string | undefined }

export type SlotFunctions<S extends string, V> = {
  [K in S]: (props?: ClassName & Selection<V>) => string
}

type Compound<V> = Selection<V> & { class: string }

function resolve(
  ...layers: (Record<string, unknown> | undefined)[]
): Record<string, string> {
  const chosen: Record<string, string> = {}
  for (const layer of layers) {
    if (layer === undefined) continue
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) chosen[key] = String(value)
    }
  }
  return chosen
}

function variantKeys(props: object): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...props }
  delete copy.className
  return copy
}

function compoundClasses<V>(
  compounds: readonly Compound<V>[] | undefined,
  chosen: Record<string, string>,
): string {
  if (compounds === undefined) return ""
  return compounds
    .filter((compound) =>
      Object.entries(compound).every(
        ([key, value]) => key === "class" || chosen[key] === String(value),
      ),
    )
    .map((compound) => compound.class)
    .join(" ")
}

/**
 * The subset of tailwind-variants' `tv` the components use: `base` or
 * `slots`, `variants`, `compoundVariants` and `defaultVariants`, with
 * conflicts resolved by `mergeClasses`.
 */
export function tv<S extends string, V extends SlotVariants<S>>(config: {
  slots: Record<S, string>
  variants?: V
  defaultVariants?: Selection<V>
}): (props?: Selection<V>) => SlotFunctions<S, V>
export function tv<V extends BaseVariants>(config: {
  base: string
  variants?: V
  compoundVariants?: readonly Compound<V>[]
  defaultVariants?: Selection<V>
}): (props?: Selection<V> & ClassName) => string
export function tv(config: {
  base?: string
  slots?: Record<string, string>
  variants?: Record<string, Record<string, string | Record<string, string>>>
  compoundVariants?: readonly Compound<BaseVariants>[]
  defaultVariants?: Record<string, unknown>
}): unknown {
  const variants = config.variants ?? {}
  function classesFor(
    slot: string | null,
    chosen: Record<string, string>,
  ): string {
    const parts: string[] = []
    for (const [name, value] of Object.entries(chosen)) {
      const entry = variants[name]?.[value]
      if (entry === undefined) continue
      if (typeof entry === "string") {
        if (slot === null) parts.push(entry)
      } else if (slot !== null && entry[slot] !== undefined) {
        parts.push(entry[slot])
      }
    }
    return parts.join(" ")
  }
  const slots = config.slots
  if (slots === undefined) {
    return (props: Record<string, unknown> & ClassName = {}) => {
      const chosen = resolve(config.defaultVariants, variantKeys(props))
      return mergeClasses(
        [
          config.base ?? "",
          classesFor(null, chosen),
          compoundClasses(config.compoundVariants, chosen),
          props.className ?? "",
        ].join(" "),
      )
    }
  }
  return (outer: Record<string, unknown> = {}) => {
    const functions: Record<
      string,
      (props?: Record<string, unknown> & ClassName) => string
    > = {}
    for (const [slot, base] of Object.entries(slots)) {
      functions[slot] = (inner = {}) => {
        const chosen = resolve(
          config.defaultVariants,
          outer,
          variantKeys(inner),
        )
        return mergeClasses(
          [base, classesFor(slot, chosen), inner.className ?? ""].join(" "),
        )
      }
    }
    return functions
  }
}

/** The variant props a `tv` style function accepts, without className. */
export type VariantProps<F> = F extends (props?: infer P) => unknown
  ? Omit<NonNullable<P>, "className">
  : never
