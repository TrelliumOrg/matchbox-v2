import type { ReactNode } from "react"

/** The allow-list as typed: entries split on commas and spaces. */
export function splitCidrs(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Entries with a /0 prefix (0.0.0.0/0, ::/0, or any address with /0): they
 * allow every address of their family, so they restrict nothing. The
 * server accepts them, as Classic's did; the page only warns.
 */
export function unrestrictedCidrs(entries: string[]): string[] {
  return entries.filter((entry) => /\/0+$/.test(entry))
}

/** The warning under the Allowed IPs field, or nothing. */
export function CidrWarning({ value }: { value: string }): ReactNode {
  const open = unrestrictedCidrs(splitCidrs(value))
  if (open.length === 0) return null
  return (
    <p
      role="status"
      className="rounded-[14px] bg-acc-soft px-3.5 py-2.5 text-[14.5px] text-acc-ink"
    >
      {open.join(", ")} allows every address, so this key is not restricted by
      IP. Use the narrowest ranges your servers call from.
    </p>
  )
}
