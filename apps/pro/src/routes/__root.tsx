import figtreeLatin from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url"
import { whenIdle } from "@matchbox/motion"
import { themeScript } from "@matchbox/tokens"
import { syncPlatform } from "@matchbox/ui/kbd"
import { lockupFoldScript } from "@matchbox/ui/lockup"
import {
  createRootRoute,
  HeadContent,
  lazyRouteComponent,
  Outlet,
  retainSearchParams,
  Scripts,
  useRouter,
} from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react"
import { classicNoteArrivalScript } from "../classic-note/note-store"
import { fetchLive } from "../data/live-query"
import { marketQuery } from "../data/queries"
import { validateRootSearch } from "../lib/viewer"
import { LiveProvider } from "../live/live-context"
import { gaugeViewScript } from "../settings/settings-store"
import { AppShell, shellEndId } from "../shell/app-shell"
import appCss from "../styles.css?url"
import { WalletMount } from "../wallet/wallet-mount"

export const Route = createRootRoute({
  validateSearch: validateRootSearch,
  search: { middlewares: [retainSearchParams(["address"])] },
  loader: () => fetchLive(marketQuery),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Matchbox Pro" },
      { name: "description", content: "Vote, claim and lock on Mezo Earn." },
    ],
    links: [
      {
        rel: "preload",
        href: figtreeLatin,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: appCss },
      // First paint waits for the whole shell: see AppShell.
      { rel: "expect", href: `#${shellEndId}`, blocking: "render" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: lazyRouteComponent(
    () => import("../shell/errors"),
    "NotFound",
  ),
  errorComponent: lazyRouteComponent(
    () => import("../shell/errors"),
    "ErrorState",
  ),
})

/** The document. Errors in the root loader still render inside it. */
function RootDocument({ children }: { children: ReactNode }): ReactNode {
  // This response's CSP nonce (see router.tsx): the inline scripts below
  // run under a strict script-src only with it.
  const nonce = useRouter().options.ssr?.nonce
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Here, not in head(): HeadContent keeps one meta per name, so the
            light one was dropped and phones tinted their bars dark only.
            After first paint ThemeSync sets both to the theme in use. */}
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#121212"
          media="(prefers-color-scheme: dark)"
        />
        <script
          suppressHydrationWarning
          nonce={nonce}
          // The script already ran: the client keeps it without shipping it.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-paint theme from @matchbox/tokens
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? themeScript : "",
          }}
        />
        <script
          suppressHydrationWarning
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the lockup starts folded when this session already folded it
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? lockupFoldScript : "",
          }}
        />
        <script
          suppressHydrationWarning
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Vote's gauge list opens in the stored view, before paint
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? gaugeViewScript : "",
          }}
        />
        <script
          suppressHydrationWarning
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: records a homepage arrival and cleans the address before paint
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? classicNoteArrivalScript : "",
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

const ThemeSync = lazy(() => import("../shell/theme-sync"))

/** Mounts the ThemeProvider once the page is idle (see theme-sync). */
function IdleThemeSync(): ReactNode {
  const [ready, setReady] = useState(false)
  useEffect(() => whenIdle(() => setReady(true)), [])
  if (!ready) return null
  return (
    <Suspense fallback={null}>
      <ThemeSync />
    </Suspense>
  )
}

function RootComponent(): ReactNode {
  const seed = Route.useLoaderData()
  // The Worker guessed the platform from the request; the browser confirms.
  useEffect(() => void syncPlatform(), [])
  return (
    <LiveProvider seed={seed}>
      <AppShell>
        <Outlet />
      </AppShell>
      <IdleThemeSync />
      <WalletMount />
    </LiveProvider>
  )
}
