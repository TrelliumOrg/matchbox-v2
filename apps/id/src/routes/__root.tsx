import figtreeLatin from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url"
import { ThemeColor } from "@matchbox/app-kit/root-document"
import { themeScript } from "@matchbox/tokens"
import * as Theme from "@matchbox/ui/theme"
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Shell } from "../app/components/shell"
import { ErrorView, NotFoundView } from "../app/components/states"
import { getViewer } from "../app/data/id-api"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  loader: () => getViewer(),
  // Sign-in and sign-out invalidate the router; otherwise the session is
  // the one the page loaded with.
  staleTime: 30_000,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Matchbox ID" },
      {
        name: "description",
        content: "Sign in with your wallet to apps built on Mezo.",
      },
      // No referrer meta: it would override /authorize's no-referrer
      // header. The Worker sets Referrer-Policy on every page.
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
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon-light.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon-dark.png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFoundView,
  errorComponent: ErrorView,
})

/**
 * The document. The theme script paints before any stylesheet, and sets
 * the browser bar's theme-color to the chosen preset (see ThemeColor).
 */
function RootDocument({ children }: { children: ReactNode }): ReactNode {
  const nonce = useRouter().options.ssr?.nonce
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeColor />
        <script
          nonce={nonce}
          suppressHydrationWarning
          // The script already ran: the client keeps it without shipping it.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-paint theme from @matchbox/tokens
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? themeScript : "",
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

function RootComponent(): ReactNode {
  const { account } = Route.useLoaderData()
  return (
    <Theme.Provider>
      <Shell account={account}>
        <Outlet />
      </Shell>
    </Theme.Provider>
  )
}
