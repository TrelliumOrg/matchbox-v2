import { useScrollRow } from "@matchbox/ui/scroll-row"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useRef } from "react"

const tabs = [
  { to: "/admin", label: "Reviews" },
  { to: "/admin/apps", label: "Apps" },
  { to: "/admin/quotas", label: "Quotas" },
  { to: "/admin/audit", label: "Audit log" },
] as const

/**
 * The staff pages' header (`YY4uOHeVTm`): "Staff", Admin with the viewer's
 * staff role, and the tabs (Reviews, Apps, Quotas, Audit log).
 */
export function StaffHeader({
  role,
  current,
}: {
  role: string
  current: (typeof tabs)[number]["to"]
}): ReactNode {
  const row = useRef<HTMLElement | null>(null)
  useScrollRow(row)
  return (
    <>
      <p className="text-[15px] text-sec">Staff</p>
      <h1 className="mt-1 flex items-center gap-3 text-[32px] font-[650] tracking-[-0.02em] text-ink">
        Admin
        <span className="rounded-full bg-soft px-2.5 py-0.5 text-[13.5px] font-semibold tracking-normal text-ink2 capitalize">
          {role}
        </span>
      </h1>
      <nav
        ref={row}
        aria-label="Admin"
        className="scroll-row mt-6 flex gap-7 shadow-[inset_0_-1px_0_var(--line)]"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            search={(search: { org?: string }) =>
              search.org === undefined ? {} : { org: search.org }
            }
            activeOptions={{ exact: true }}
            aria-current={tab.to === current ? "page" : undefined}
            className={`flex-none whitespace-nowrap border-b-2 pb-3 text-[16px] font-medium outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${tab.to === current ? "border-ink text-ink" : "border-transparent text-sec hover:text-ink"}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  )
}
