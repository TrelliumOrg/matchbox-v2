import figtreeLatin from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url"
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { BlockNumber } from "../components/block-number"
import { themeScript } from "../lib/theme-script"
import appCss from "../styles.css?url"
import { ConnectButton } from "../wallet/connect-button"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Matchbox spike" },
      { name: "description", content: "TanStack Start on Workers spike" },
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
    ],
  }),
  component: RootComponent,
})

function RootComponent(): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: pre-paint theme */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <header className="top-bar">
          <Link to="/" className="brand">
            Matchbox spike
          </Link>
          <ConnectButton />
        </header>
        <main className="content">
          <Outlet />
        </main>
        <BlockNumber />
        <Scripts />
      </body>
    </html>
  )
}
