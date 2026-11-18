import type {
  MeResponse,
  OrganizationSummary,
} from "@matchbox/contracts/console"
import { FeedbackEntry, FeedbackIcon } from "@matchbox/feedback-ui/entry"
import * as Avatar from "@matchbox/ui/avatar"
import { Icon } from "@matchbox/ui/icons"
import * as Lockup from "@matchbox/ui/lockup"
import { useScrollRow } from "@matchbox/ui/scroll-row"
import { Link, useRouter } from "@tanstack/react-router"
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useRef,
  useState,
} from "react"
import { developerDocsUrl } from "../lib/docs-links"
import { initials, nameHue } from "../lib/marks"
import { Glyph, type GlyphName } from "./glyphs"
import { CreateOrganization, OrgSwitcher } from "./org-switcher"

function loadMenu(): Promise<typeof import("./account-menu-panel")> {
  return import("./account-menu-panel")
}

const AccountMenuPanel = lazy(loadMenu)

function NavLink({
  to,
  glyph,
  children,
  exact = false,
}: {
  to: "/" | "/apps" | "/usage" | "/organization" | "/account" | "/admin"
  glyph: GlyphName
  children: ReactNode
  exact?: boolean
}): ReactNode {
  return (
    <Link
      to={to}
      search={(current: { org?: string }) =>
        current.org === undefined ? {} : { org: current.org }
      }
      activeOptions={{ exact, includeSearch: false }}
      className="flex h-11 flex-none items-center gap-3.5 whitespace-nowrap rounded-[22px] px-4 text-[16px] font-medium text-ink outline-none hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink data-[status=active]:bg-soft2"
    >
      <Glyph name={glyph} size={19} />
      {children}
    </Link>
  )
}

/**
 * The console frame (`WpDLhNZgA7`): sidebar with the lockup, navigation
 * and the organization, and the account in the top bar. Only the pages
 * rebuilt so far are linked; see the README for the rest.
 */
export function ConsoleShell({
  me,
  org,
  children,
}: {
  me: MeResponse
  org: OrganizationSummary | null
  children: ReactNode
}): ReactNode {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const phoneNav = useRef<HTMLElement | null>(null)
  useScrollRow(phoneNav)
  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false)
    if (restoreFocus) menuButton.current?.focus()
  }, [])

  async function signOut(): Promise<void> {
    setSigningOut(true)
    try {
      const { auth } = await import("../lib/api")
      await auth.signOut()
    } finally {
      setSigningOut(false)
      await router.invalidate()
      await router.navigate({ to: "/sign-in", search: {} })
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[280px_1fr]">
      <aside className="flex flex-col px-6 pt-10 pb-6 max-lg:hidden">
        <Link
          to="/"
          aria-label="Matchbox Developer"
          className="mb-10 ml-3 w-fit rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          <Lockup.Root product="developer" form="short" height={22} />
        </Link>
        <nav aria-label="Console" className="flex flex-col gap-1">
          <NavLink to="/" glyph="layout-grid" exact>
            Overview
          </NavLink>
          <NavLink to="/apps" glyph="box">
            Apps
          </NavLink>
          <NavLink to="/usage" glyph="activity">
            Usage
          </NavLink>
          <a
            href={developerDocsUrl}
            className="flex h-11 flex-none items-center gap-3.5 whitespace-nowrap rounded-[22px] px-4 text-[16px] font-medium text-ink outline-none hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
          >
            <Glyph name="book" size={19} />
            Docs
          </a>
        </nav>
        <p className="mt-8 mb-2 px-4 text-[14px] text-sec">Settings</p>
        <nav aria-label="Settings" className="flex flex-col gap-1">
          <NavLink to="/organization" glyph="building">
            Organization
          </NavLink>
          <NavLink to="/account" glyph="user">
            Account
          </NavLink>
        </nav>
        {me.staffRole === null ? null : (
          <>
            <p className="mt-8 mb-2 px-4 text-[14px] text-sec">Staff</p>
            <nav aria-label="Staff" className="flex flex-col gap-1">
              <NavLink to="/admin" glyph="shield">
                Admin
              </NavLink>
            </nav>
          </>
        )}
        {import.meta.env.VITE_FEEDBACK_URL ? (
          <FeedbackEntry
            endpoint={import.meta.env.VITE_FEEDBACK_URL}
            surface="developer"
            className="mt-auto mb-3 flex h-10 flex-none cursor-pointer items-center gap-3.5 rounded-[20px] px-4 text-[15px] text-sec outline-none hover:text-ink2 focus-visible:outline-2 focus-visible:outline-ink"
          >
            <FeedbackIcon />
            Feedback
          </FeedbackEntry>
        ) : null}
        {org === null ? null : (
          <OrgSwitcher current={org} organizations={me.organizations} />
        )}
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex h-[84px] items-center justify-end gap-3 px-5 lg:px-14">
          <Link
            to="/"
            aria-label="Matchbox Developer"
            className="mr-auto lg:hidden"
          >
            <Lockup.Root product="developer" form="short" height={20} />
          </Link>
          <span className="relative">
            <button
              ref={menuButton}
              type="button"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              onPointerEnter={() => void loadMenu()}
              onFocus={() => void loadMenu()}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-11 cursor-pointer items-center gap-2.5 rounded-[22px] pr-2 pl-1 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
            >
              {me.account.avatarUrl === null ? (
                <Avatar.Root
                  initials={initials(me.account.displayName)}
                  hue={nameHue(me.account.id)}
                  size={40}
                />
              ) : (
                <img
                  src={me.account.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-10 rounded-full bg-soft object-cover"
                />
              )}
              <span className="text-[15px] font-semibold text-ink max-sm:hidden">
                {me.account.displayName}
              </span>
              <Icon
                name="chevron-down"
                size={16}
                strokeWidth={2}
                className={`text-sec transition-transform ${menuOpen ? "rotate-180" : ""}`}
              />
            </button>
            {menuOpen ? (
              <Suspense fallback={null}>
                <AccountMenuPanel
                  me={me}
                  signingOut={signingOut}
                  onSignOut={() => void signOut()}
                  onClose={closeMenu}
                />
              </Suspense>
            ) : null}
          </span>
        </header>
        <nav
          ref={phoneNav}
          aria-label="Console"
          className="scroll-row -mt-2 mb-4 flex gap-1 px-3 lg:hidden"
        >
          <NavLink to="/" glyph="layout-grid" exact>
            Overview
          </NavLink>
          <NavLink to="/apps" glyph="box">
            Apps
          </NavLink>
          <NavLink to="/usage" glyph="activity">
            Usage
          </NavLink>
          <a
            href={developerDocsUrl}
            className="flex h-11 flex-none items-center gap-3.5 whitespace-nowrap rounded-[22px] px-4 text-[16px] font-medium text-ink outline-none hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
          >
            <Glyph name="book" size={19} />
            Docs
          </a>
          <NavLink to="/organization" glyph="building">
            Organization
          </NavLink>
          <NavLink to="/account" glyph="user">
            Account
          </NavLink>
          {me.staffRole === null ? null : (
            <NavLink to="/admin" glyph="shield">
              Admin
            </NavLink>
          )}
        </nav>
        <main className="flex-1 px-5 pt-2 pb-16 lg:px-14">
          {org === null ? (
            <section
              aria-labelledby="no-org-title"
              className="mx-auto flex w-full max-w-[480px] flex-col gap-6 pt-16"
            >
              <h1
                id="no-org-title"
                className="text-[30px] font-[650] tracking-[-0.02em] text-ink"
              >
                Create an organization
              </h1>
              <CreateOrganization />
            </section>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  )
}
