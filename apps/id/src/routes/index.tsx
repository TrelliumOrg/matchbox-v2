import { useScrollRow } from "@matchbox/ui/scroll-row"
import {
  createFileRoute,
  getRouteApi,
  Link,
  redirect,
} from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useRef } from "react"
import { ConnectedApps } from "../app/account/connected-apps"
import { IdentityStrip } from "../app/account/identity-strip"
import { DeviceSessions } from "../app/account/sessions"
import { getAccount } from "../app/data/id-api"
import { validateAccountSearch } from "../app/lib/search"

const AppearancePicker = lazy(() => import("../app/account/appearance-picker"))

const root = getRouteApi("__root__")

const titles = {
  apps: "Connected apps",
  sessions: "Sessions",
  appearance: "Appearance",
} as const

/**
 * Account (`-pDRgxuGc8`, `J5gOG7FURB`, `eh7U5eiZ_v`, empty and Discord not
 * linked `mS981nOomD`, phone `lq71BaymPd`): the wallet and Discord, then
 * connected apps, sessions and appearance as tabs.
 */
export const Route = createFileRoute("/")({
  validateSearch: validateAccountSearch,
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: async ({ deps }) => {
    const data = await getAccount()
    if (data.kind === "signed-out") {
      throw redirect({
        to: "/sign-in",
        search: { return: deps.tab === undefined ? "/" : `/?tab=${deps.tab}` },
        replace: true,
      })
    }
    return data
  },
  head: ({ match }) => ({
    meta: [{ title: titles[match.search.tab ?? "apps"] }],
  }),
  component: AccountPage,
})

function TabLink({
  tab,
  current,
  count,
}: {
  tab: keyof typeof titles
  current: keyof typeof titles
  count: number | null
}): ReactNode {
  const active = tab === current
  return (
    <Link
      to="/"
      search={tab === "apps" ? {} : { tab }}
      replace
      activeOptions={{ exact: true, includeSearch: true }}
      aria-current={active ? "page" : undefined}
      className={`flex h-[38px] flex-none items-center gap-2 whitespace-nowrap rounded-[19px] px-[17px] text-[15px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-ink ${active ? "bg-raised text-ink shadow-lift" : "text-sec hover:text-ink"}`}
    >
      {titles[tab]}
      {count === null ? null : (
        <span className="tabular-nums text-mut">{count}</span>
      )}
    </Link>
  )
}

function AccountPage(): ReactNode {
  const { tab: requested } = Route.useSearch()
  const tab = requested ?? "apps"
  const data = Route.useLoaderData()
  const tabRow = useRef<HTMLElement | null>(null)
  useScrollRow(tabRow)
  const { account } = root.useLoaderData()
  if (account === null) return null
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col pt-4">
      <header>
        <p className="text-[15px] text-sec">Account</p>
        <h1 className="mt-1 text-[32px] font-[650] leading-[1.15] tracking-[-0.02em] text-ink max-md:text-[28px]">
          {titles[tab]}
        </h1>
      </header>
      <IdentityStrip account={account} />
      <nav
        ref={tabRow}
        aria-label="Account"
        className="scroll-row mt-10 flex w-fit max-w-full gap-0.5 rounded-[22px] bg-soft p-[3px]"
      >
        <TabLink tab="apps" current={tab} count={data.grants.data.length} />
        <TabLink
          tab="sessions"
          current={tab}
          count={data.sessions.data.length}
        />
        <TabLink tab="appearance" current={tab} count={null} />
      </nav>
      <section aria-label={titles[tab]} className="mt-7">
        {tab === "apps" ? (
          <ConnectedApps grants={data.grants} />
        ) : tab === "sessions" ? (
          <DeviceSessions sessions={data.sessions.data} />
        ) : (
          <Suspense fallback={<div className="min-h-[480px]" />}>
            <AppearancePicker />
          </Suspense>
        )}
      </section>
    </div>
  )
}
