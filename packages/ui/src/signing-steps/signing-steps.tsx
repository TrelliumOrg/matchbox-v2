import { MorphText } from "@matchbox/motion"
import type { ReactNode } from "react"
import { Glyph, shapes } from "../icons"
import { tv } from "../tv"

/**
 * Signing steps (Review vote `xFq24xVEdT`, Signing `tWxE5ZYSSC`, lock sheets
 * `bFRmKIn4eA`): one row per signature, labelled with what the wallet will
 * show. In review each row carries its number; while signing the badge and
 * the status word change in place ("Confirm in your wallet" to "Signed"),
 * the word morphing with torph. A signed step can link its transaction
 * inline ("Signed, view on Matchscan"); a step that failed on chain puts
 * the link on its own line under the reason.
 */

export type StepStatus = "review" | "pending" | "active" | "done" | "failed"

const step = tv({
  slots: {
    row: "flex min-h-[56px] items-center gap-4",
    badge:
      "grid size-10 flex-none place-items-center rounded-full text-[15px] font-[650] tabular-nums",
    label: "block text-base font-semibold",
    status: "block text-[14.5px] font-semibold",
    link: "rounded-sm font-semibold text-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink",
  },
  variants: {
    status: {
      review: {
        badge: "bg-soft text-ink2 dark:bg-soft2",
        status: "font-normal text-sec",
      },
      pending: {
        badge: "bg-soft text-sec dark:bg-soft2",
        label: "text-sec",
        status: "font-normal text-sec",
      },
      active: { badge: "bg-acc-soft text-acc", status: "text-acc-ink" },
      done: { badge: "bg-pos-soft text-pos", status: "text-pos" },
      failed: { badge: "bg-neg-soft text-neg", status: "text-neg" },
    },
  },
})

export function Root({
  label = "Signatures",
  children,
}: {
  label?: string
  children: ReactNode
}): ReactNode {
  return (
    <ol aria-label={label} className="flex flex-col gap-1.5">
      {children}
    </ol>
  )
}

Root.displayName = "SigningSteps"

export type StepProps = {
  index: number
  label: string
  status: StepStatus
  /** Under the label: "Exact amount" in review, the state while signing. */
  detail?: string | undefined
  /** Right aligned, for example "41,260 votes". */
  aside?: ReactNode
  /** The step's transaction on an explorer: inline after the detail, or on its own line when failed. */
  link?: { href: string; label: string } | null | undefined
}

function Badge({
  status,
  index,
}: {
  status: StepStatus
  index: number
}): ReactNode {
  if (status === "done")
    return (
      <Glyph
        shape={shapes.check}
        size={18}
        strokeWidth={2.4}
        className="mbx-draw"
      />
    )
  if (status === "failed")
    return <Glyph shape={shapes.x} size={18} strokeWidth={2.4} />
  if (status === "active") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={20}
        height={20}
        fill="none"
        strokeLinecap="round"
        aria-hidden="true"
        data-mbx-motion=""
        className="animate-[mbx-spin_1s_linear_infinite]"
      >
        <path
          d="M12 4a8 8 0 1 1-7.4 5"
          stroke="currentColor"
          strokeWidth="2.4"
        />
      </svg>
    )
  }
  return <>{index}</>
}

export function Step({
  index,
  label,
  status,
  detail,
  aside,
  link,
}: StepProps): ReactNode {
  const s = step({ status })
  const anchor =
    link === undefined || link === null ? null : (
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer noopener"
        className={s.link()}
      >
        {link.label}
      </a>
    )
  return (
    <li
      className={s.row()}
      aria-current={status === "active" ? "step" : undefined}
    >
      <span className={s.badge()} aria-hidden="true">
        <Badge status={status} index={index} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={s.label()}>{label}</span>
        {detail === undefined ? null : anchor === null ||
          status === "failed" ? (
          <MorphText as="span" className={s.status()}>
            {detail}
          </MorphText>
        ) : (
          <span className={s.status()}>
            <MorphText as="span">{detail}</MorphText>,{" "}
            <span className="font-normal">{anchor}</span>
          </span>
        )}
        {anchor !== null && status === "failed" ? (
          <span className="block text-[14.5px]">{anchor}</span>
        ) : null}
      </span>
      {aside === undefined ? null : (
        <span className="flex-none text-[15px] text-sec tabular-nums">
          {aside}
        </span>
      )}
    </li>
  )
}

Step.displayName = "SigningSteps.Step"
