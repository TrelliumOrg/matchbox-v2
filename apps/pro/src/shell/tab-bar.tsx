import { Glyph } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { isActive, navItems, usePathname } from "./nav-items"

export function TabBar(): ReactNode {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Pro"
      className="fixed inset-x-0 bottom-0 z-30 h-(--tabbar) border-t border-line bg-bg pb-(--tabbar-inset) md:hidden"
    >
      <ul className="grid h-full grid-cols-4">
        {navItems
          .filter((item) => item.phone)
          .map((item) => {
            const active = isActive(item, pathname)
            return (
              <li key={item.to} className="grid">
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center justify-center gap-1 text-[12.5px] font-medium outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink ${active ? "text-ink" : "text-sec"}`}
                >
                  <Glyph shape={item.icon} size={24} strokeWidth={1.7} />
                  {item.label}
                </Link>
              </li>
            )
          })}
      </ul>
    </nav>
  )
}
