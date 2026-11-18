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
import { NotFoundView, PageError } from "../app/components/states"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      // The Worker rewrites title, description and link previews per route
      // (worker/meta.ts), as it did for the SPA.
      { title: "Matchbox Developer" },
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
  errorComponent: PageError,
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
  return (
    <Theme.Provider>
      <Outlet />
    </Theme.Provider>
  )
}
