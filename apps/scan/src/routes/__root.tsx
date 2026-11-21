import figtreeLatin from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url"
import {
  IdleThemeSync,
  RootDocument,
  rootHead,
} from "@matchbox/app-kit/root-document"
import { LiveProvider } from "@matchbox/live/context"
import { syncPlatform } from "@matchbox/ui/kbd"
import { WalletMount } from "@matchbox/wallet/mount"
import {
  createRootRoute,
  lazyRouteComponent,
  Outlet,
} from "@tanstack/react-router"
import { type ReactNode, useEffect } from "react"
import type { ShellSeed } from "../data/shell"
import { ShellProvider, useShell } from "../data/shell-context"
import { getShell } from "../data/shell-fn"
import { AppShell } from "../shell/app-shell"
import { AppearanceHost } from "../shell/appearance"
import { walletOptions } from "../shell/wallet-options"
import appCss from "../styles.css?url"

const description =
  "Mezo's explorer: blocks, transactions, gauges, locks and loans."

export const Route = createRootRoute({
  loader: () => getShell(),
  // The shell's head and prices are a starting point: the head store moves
  // on from there, so client navigations never refetch them.
  staleTime: Number.POSITIVE_INFINITY,
  // The link preview tags are the Worker's (share-card.ts), not script.
  head: () =>
    rootHead({
      title: "Matchscan",
      description,
      font: figtreeLatin,
      stylesheet: appCss,
    }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: lazyRouteComponent(
    () => import("../shell/not-found"),
    "NotFoundPage",
  ),
  errorComponent: lazyRouteComponent(
    () => import("@matchbox/app-kit/states"),
    "ErrorState",
  ),
})

async function pollLatest(): Promise<number> {
  return (await getShell()).head?.number ?? 0
}

/**
 * The live head follows the shell's as it refreshes, as well as BlockHub.
 * The config is the loader's: a refreshed shell's is a new object, which
 * would restart the head source.
 */
function Live({
  seed,
  children,
}: {
  seed: ShellSeed
  children: ReactNode
}): ReactNode {
  const shell = useShell()
  return (
    <LiveProvider
      head={shell.head?.number ?? 0}
      config={seed.live}
      rpc={seed.rpc}
      pollLatest={pollLatest}
    >
      {children}
    </LiveProvider>
  )
}

function RootComponent(): ReactNode {
  const seed = Route.useLoaderData()
  // The Worker guessed the platform from the request; the browser confirms.
  useEffect(() => void syncPlatform(), [])
  return (
    <ShellProvider seed={seed}>
      <Live seed={seed}>
        <AppShell>
          <Outlet />
        </AppShell>
        <IdleThemeSync>
          <AppearanceHost />
        </IdleThemeSync>
        <WalletMount rpc={seed.rpc} options={walletOptions} />
      </Live>
    </ShellProvider>
  )
}
