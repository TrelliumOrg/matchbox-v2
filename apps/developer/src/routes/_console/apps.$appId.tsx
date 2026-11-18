import { Icon } from "@matchbox/ui/icons"
import { useScrollRow } from "@matchbox/ui/scroll-row"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import { createFileRoute, Link } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useRef } from "react"
import { ApiKeys } from "../../app/console/api-keys"
import { AppMark } from "../../app/console/app-row"
import { CreateEnvironment } from "../../app/console/create-environment"
import {
  getAppDetail,
  getEnvironmentsExtras,
  getOAuthExtras,
  getUsageTab,
} from "../../app/data/console-api"

// Each tab's panel is its own chunk: a page loads only the tab it shows.
const ClientSecrets = lazy(() =>
  import("../../app/console/client-secrets").then((module) => ({
    default: module.ClientSecrets,
  })),
)
const EnvironmentsPanel = lazy(() =>
  import("../../app/console/environments-panel").then((module) => ({
    default: module.EnvironmentsPanel,
  })),
)
const OAuthPanel = lazy(() =>
  import("../../app/console/oauth-panel").then((module) => ({
    default: module.OAuthPanel,
  })),
)
const RequestLog = lazy(() =>
  import("../../app/console/request-log").then((module) => ({
    default: module.RequestLog,
  })),
)
const SettingsPanel = lazy(() =>
  import("../../app/console/settings-panel").then((module) => ({
    default: module.SettingsPanel,
  })),
)

type Tab = "keys" | "secrets" | "oauth" | "usage" | "environment" | "settings"

const tabs: { tab: Tab; label: string }[] = [
  { tab: "environment", label: "Environments" },
  { tab: "keys", label: "API keys" },
  { tab: "secrets", label: "Client secrets" },
  { tab: "oauth", label: "OAuth" },
  { tab: "usage", label: "Usage" },
  { tab: "settings", label: "Settings" },
]

type Search = { org?: string; tab?: Tab; env?: "test" | "live" }

/**
 * An app (`WXZBHwQdbF` API keys, `Or71vVnUWj` client secrets, `45HRaWcjCi`
 * environments): one environment at a time, test or live.
 */
export const Route = createFileRoute("/_console/apps/$appId")({
  validateSearch: (input: Record<string, unknown>): Search => {
    const search: Search = {}
    if (typeof input.org === "string") search.org = input.org
    if (
      input.tab === "keys" ||
      input.tab === "secrets" ||
      input.tab === "oauth" ||
      input.tab === "usage" ||
      input.tab === "settings" ||
      input.tab === "environment"
    ) {
      search.tab = input.tab
    }
    if (input.env === "test" || input.env === "live") search.env = input.env
    return search
  },
  loaderDeps: ({ search }) => ({
    tab: search.tab ?? "environment",
    env: search.env,
  }),
  loader: async ({ params, deps }) => {
    const detail = await getAppDetail({ data: { appId: params.appId } })
    // The Environments tab's history and 7-day requests, read with the page.
    const extras =
      deps.tab === "environment"
        ? await getEnvironmentsExtras({
            data: {
              orgId: detail.app.organizationId,
              environmentIds: detail.credentials.map(
                (entry) => entry.environmentId,
              ),
            },
          })
        : null
    // The OAuth tab's consent preview and grant stats for the shown kind.
    const kind =
      deps.env ??
      (detail.app.environments.some((env) => env.kind === "live")
        ? "live"
        : "test")
    const shown = detail.app.environments.find((env) => env.kind === kind)
    const oauth =
      deps.tab === "oauth" && shown !== undefined
        ? await getOAuthExtras({ data: { environmentId: shown.id } })
        : null
    const usage =
      deps.tab === "usage" && shown !== undefined
        ? await getUsageTab({ data: { environmentId: shown.id } })
        : null
    return { ...detail, extras, oauth, usage }
  },
  component: AppPage,
})

function AppPage(): ReactNode {
  const { app, credentials, extras, oauth, usage } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const tab = search.tab ?? "environment"
  const tabRow = useRef<HTMLElement | null>(null)
  useScrollRow(tabRow)
  const kind =
    search.env ??
    (app.environments.some((env) => env.kind === "live") ? "live" : "test")
  const environment = app.environments.find((env) => env.kind === kind)
  const set = credentials.find(
    (entry) => entry.environmentId === environment?.id,
  )

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col">
      <Link
        to="/apps"
        search={search.org === undefined ? {} : { org: search.org }}
        className="flex w-fit items-center gap-1.5 text-[15.5px] text-sec hover:text-ink"
      >
        <Icon name="chevron-left" size={16} />
        Apps
      </Link>
      <header className="mt-4 flex flex-wrap items-center gap-4">
        <AppMark app={app} size={48} />
        <h1 className="text-[34px] font-[650] tracking-[-0.02em] text-ink">
          {app.name}
        </h1>
        <span className="rounded-full bg-pos-soft px-2.5 py-0.5 text-[14px] font-medium text-pos capitalize">
          {app.status}
        </span>
      </header>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4 border-b border-line">
        <nav
          ref={tabRow}
          aria-label="App"
          className="scroll-row -mb-px flex max-w-full gap-7"
        >
          {tabs.map((entry) => (
            <Link
              key={entry.tab}
              to="/apps/$appId"
              params={{ appId: app.id }}
              search={{ ...search, tab: entry.tab }}
              replace
              aria-current={entry.tab === tab ? "page" : undefined}
              className={`flex-none whitespace-nowrap border-b-2 pb-3 text-[16px] font-medium outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${entry.tab === tab ? "border-ink text-ink" : "border-transparent text-sec hover:text-ink"}`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        {app.environments.length > 0 && tab !== "settings" ? (
          <SegmentedControl.Root
            size="md"
            aria-label="Environment"
            value={kind}
            onValueChange={(value) => {
              if (value === "test" || value === "live") {
                void navigate({
                  search: { ...search, env: value },
                  replace: true,
                })
              }
            }}
            className="mb-3 w-[160px]"
          >
            <SegmentedControl.Item value="test">Test</SegmentedControl.Item>
            <SegmentedControl.Item value="live">Live</SegmentedControl.Item>
          </SegmentedControl.Root>
        ) : null}
      </div>

      <section className="mt-10">
        <Suspense fallback={null}>
          {environment === undefined || set === undefined ? (
            <CreateEnvironment appId={app.id} kind={kind} />
          ) : tab === "keys" ? (
            <ApiKeys environment={environment} keys={set.apiKeys} />
          ) : tab === "secrets" ? (
            <ClientSecrets
              environment={set.environment}
              secrets={set.clientSecrets}
            />
          ) : tab === "usage" ? (
            usage === null ? null : (
              <RequestLog
                environmentId={environment.id}
                data={usage}
                apiKeys={set.apiKeys}
              />
            )
          ) : tab === "settings" ? (
            <SettingsPanel app={app} />
          ) : tab === "oauth" ? (
            <OAuthPanel environment={set.environment} extras={oauth} />
          ) : (
            <EnvironmentsPanel
              extras={extras}
              environments={credentials.map((entry) => entry.environment)}
              selected={set.environment}
            />
          )}
        </Suspense>
      </section>
    </div>
  )
}
