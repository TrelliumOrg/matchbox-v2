import type { ComponentProps, ReactNode } from "react"
import { mergeClasses } from "../tv"

/**
 * Long-form type for docs pages (Doop `cA_kCfY56H`): body 16/26 in ink2 at
 * a 600px measure, title 32/650, h2 24/650, h3 18/600, inline code DM Mono
 * 14 on soft2, links underlined in ink, tabular figures in tables. Each
 * element is its own component so the docs renderer maps a page tree onto
 * them one to one; nothing styles descendants it did not render.
 */

function cx(...classes: (string | undefined)[]): string {
  return mergeClasses(classes.filter(Boolean).join(" "))
}

export function Root({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={cx("min-w-0 text-ink2", className)} {...props} />
}
Root.displayName = "Prose.Root"

export function Eyebrow({
  className,
  ...props
}: ComponentProps<"p">): ReactNode {
  return (
    <p
      className={cx(
        "flex h-5 items-center gap-1.5 text-[14.5px] text-sec",
        className,
      )}
      {...props}
    />
  )
}
Eyebrow.displayName = "Prose.Eyebrow"

export function Title({
  className,
  ...props
}: ComponentProps<"h1">): ReactNode {
  return (
    <h1
      className={cx(
        "mt-1.5 text-[32px] leading-[1.2] font-[650] tracking-[-0.02em] text-ink max-sm:text-[28px]",
        className,
      )}
      {...props}
    />
  )
}
Title.displayName = "Prose.Title"

export function Lead({ className, ...props }: ComponentProps<"p">): ReactNode {
  return (
    <p
      className={cx(
        "mt-3.5 text-[18px] leading-[29px] text-ink max-sm:text-[17px] max-sm:leading-[28px]",
        className,
      )}
      {...props}
    />
  )
}
Lead.displayName = "Prose.Lead"

export function P({ className, ...props }: ComponentProps<"p">): ReactNode {
  return (
    <p
      className={cx("mt-3.5 text-base leading-[26px] text-ink2", className)}
      {...props}
    />
  )
}
P.displayName = "Prose.P"

const heading =
  "scroll-mt-6 text-ink outline-none target:underline target:decoration-acc target:decoration-2 target:underline-offset-[6px]"

export function H2({ className, ...props }: ComponentProps<"h2">): ReactNode {
  return (
    <h2
      className={cx(
        heading,
        "mt-12 text-[24px] leading-[1.25] font-[650] tracking-[-0.015em] max-sm:mt-10 max-sm:text-[22px]",
        className,
      )}
      {...props}
    />
  )
}
H2.displayName = "Prose.H2"

export function H3({ className, ...props }: ComponentProps<"h3">): ReactNode {
  return (
    <h3
      className={cx(
        heading,
        "mt-[30px] text-[18px] leading-[1.3] font-semibold",
        className,
      )}
      {...props}
    />
  )
}
H3.displayName = "Prose.H3"

export function H4({ className, ...props }: ComponentProps<"h4">): ReactNode {
  return (
    <h4
      className={cx(heading, "mt-6 text-base font-semibold", className)}
      {...props}
    />
  )
}
H4.displayName = "Prose.H4"

export const linkClass =
  "text-ink underline decoration-mut decoration-[1.5px] underline-offset-[3px] outline-none hover:decoration-ink focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

export function A({ className, ...props }: ComponentProps<"a">): ReactNode {
  return <a className={cx(linkClass, className)} {...props} />
}
A.displayName = "Prose.A"

export function Code({
  className,
  ...props
}: ComponentProps<"code">): ReactNode {
  return (
    <code
      className={cx(
        "rounded-md bg-soft2 px-1.5 py-px font-mono text-[14px] text-ink [overflow-wrap:anywhere]",
        className,
      )}
      {...props}
    />
  )
}
Code.displayName = "Prose.Code"

export function Strong({
  className,
  ...props
}: ComponentProps<"strong">): ReactNode {
  return (
    <strong className={cx("font-semibold text-ink", className)} {...props} />
  )
}
Strong.displayName = "Prose.Strong"

export function Ul({ className, ...props }: ComponentProps<"ul">): ReactNode {
  return <ul className={cx("mt-2.5", className)} {...props} />
}
Ul.displayName = "Prose.Ul"

export function Ol({ className, ...props }: ComponentProps<"ol">): ReactNode {
  return (
    <ol
      className={cx(
        "mt-2.5 list-decimal pl-6 marker:text-sec [&>li]:pl-1",
        className,
      )}
      {...props}
    />
  )
}
Ol.displayName = "Prose.Ol"

/** A bullet item; inside an Ol the browser draws the number instead. */
export function Li({ className, ...props }: ComponentProps<"li">): ReactNode {
  return (
    <li
      className={cx(
        "mt-1.5 text-base leading-[26px] text-ink2 [ul>&]:relative [ul>&]:pl-[22px] [ul>&]:before:absolute [ul>&]:before:top-[11px] [ul>&]:before:left-1.5 [ul>&]:before:size-[5px] [ul>&]:before:rounded-full [ul>&]:before:bg-sec",
        className,
      )}
      {...props}
    />
  )
}
Li.displayName = "Prose.Li"

export function Blockquote({
  className,
  ...props
}: ComponentProps<"blockquote">): ReactNode {
  return (
    <blockquote
      className={cx("mt-4 border-l-2 border-line pl-4 text-sec", className)}
      {...props}
    />
  )
}
Blockquote.displayName = "Prose.Blockquote"

export function Hr({ className, ...props }: ComponentProps<"hr">): ReactNode {
  return <hr className={cx("my-10 border-line", className)} {...props} />
}
Hr.displayName = "Prose.Hr"

/**
 * Tables scroll sideways inside their own box when they are wider than the
 * column; on phones each row becomes a two-line list row (first cell as the
 * title, the rest under it), as the docs guideline asks.
 */
export function Table({
  className,
  children,
  ...props
}: ComponentProps<"table">): ReactNode {
  return (
    <div className="mt-[18px] max-w-full overflow-x-auto">
      <table
        className={cx(
          "w-full border-collapse text-[15px] tabular-nums max-sm:[&_thead]:sr-only max-sm:[&_tr]:flex max-sm:[&_tr]:flex-wrap max-sm:[&_tr]:gap-x-3 max-sm:[&_tr]:border-b max-sm:[&_tr]:border-line max-sm:[&_tr]:py-3 max-sm:[&_td]:border-0 max-sm:[&_td]:p-0 max-sm:[&_td:first-child]:w-full",
          className,
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  )
}
Table.displayName = "Prose.Table"

export function Th({ className, ...props }: ComponentProps<"th">): ReactNode {
  return (
    <th
      className={cx(
        "border-b border-line pr-3 pb-2.5 text-left text-[14px] font-medium text-sec aria-[sort]:text-ink [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  )
}
Th.displayName = "Prose.Th"

/**
 * A body cell. `label` is its column's heading: on phones, where the table
 * reflows and its head row is hidden, the value shows it in front, so a row
 * reads "veMEZO 1.2M" and not a run of bare values. Screen readers keep the
 * table's own headers, so the label is hidden from them.
 */
export function Td({
  className,
  label,
  children,
  ...props
}: ComponentProps<"td"> & { label?: string | undefined }): ReactNode {
  return (
    <td
      className={cx(
        "border-b border-line py-3 pr-3 align-middle leading-[22px] text-ink2 first:font-semibold first:text-ink [&[align=right]]:text-right",
        className,
      )}
      {...props}
    >
      {label === undefined || label === "" ? null : (
        <span aria-hidden="true" className="mr-1.5 text-sec sm:hidden">
          {label}
        </span>
      )}
      {children}
    </td>
  )
}
Td.displayName = "Prose.Td"

export function Kbd({ className, ...props }: ComponentProps<"kbd">): ReactNode {
  return (
    <kbd
      className={cx(
        "inline-grid h-[22px] min-w-[22px] place-items-center rounded-md bg-raised px-1.5 font-sans text-[12px] leading-none font-semibold text-sec shadow-[inset_0_0_0_1px_var(--line),inset_0_-1px_0_var(--line)]",
        className,
      )}
      {...props}
    />
  )
}
Kbd.displayName = "Prose.Kbd"
