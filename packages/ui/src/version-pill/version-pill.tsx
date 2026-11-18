import type { ReactNode } from "react"

/**
 * The API version above the reference tree (Doop `vFd6_tfSDd`): the path
 * version in ink and the document version in grey. Only v1 exists, so it
 * is a label; the switch (`kirV1T3t2j`) comes with v2.
 */

export type RootProps = { major: string; version: string; className?: string }

export function Root({ major, version, className }: RootProps): ReactNode {
  return (
    <p
      className={`flex h-[34px] w-fit items-center gap-1.5 rounded-[17px] bg-soft px-3 text-[14px] ${className ?? ""}`}
    >
      <span className="font-semibold text-ink">{major}</span>
      <span className="text-sec">
        <span className="sr-only">API version </span>
        {version}
      </span>
    </p>
  )
}
Root.displayName = "VersionPill"
