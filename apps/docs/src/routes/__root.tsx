import figtreeLatin from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url"
import {
  IdleThemeSync,
  rootHead,
  ShellEnd,
  ThemeColor,
} from "@matchbox/app-kit/root-document"
import { themeScript } from "@matchbox/tokens"
import {
  createRootRoute,
  HeadContent,
  lazyRouteComponent,
  Outlet,
  Scripts,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { AppearanceHost } from "../shell/appearance"
import { DocsShell } from "../shell/docs-shell"
import { platformScript } from "../shell/platform"
import appCss from "../styles.css?url"

const description =
  "Guides and reference for Matchbox Pro, Matchscan, Matchbox ID, Matchbox Developer and the Mezo concepts they share."

/**
 * The document every docs page is prerendered into. Two inline scripts run
 * before paint: the theme from @matchbox/tokens and the key caps' platform
 * (static pages cannot read the request, so the browser decides). The CSP
 * allows exactly these by hash (scripts/postbuild.mjs).
 */
function DocsDocument({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeColor />
        <script
          suppressHydrationWarning
          // The script already ran: the client keeps it without shipping it.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-paint theme from @matchbox/tokens
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? themeScript : "",
          }}
        />
        <script
          suppressHydrationWarning
          // biome-ignore lint/security/noDangerouslySetInnerHtml: key caps follow the platform before paint
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? platformScript : "",
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

export const Route = createRootRoute({
  head: () => {
    const base = rootHead({
      title: "Matchbox Docs",
      description,
      font: figtreeLatin,
      stylesheet: appCss,
    })
    return {
      meta: [
        ...base.meta,
        { property: "og:site_name", content: "Matchbox Docs" },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
      links: base.links,
    }
  },
  shellComponent: DocsDocument,
  component: RootComponent,
  notFoundComponent: lazyRouteComponent(
    () => import("../shell/not-found"),
    "NotFoundPage",
  ),
})

function RootComponent(): ReactNode {
  return (
    <>
      <DocsShell>
        <Outlet />
      </DocsShell>
      <ShellEnd />
      <IdleThemeSync>
        <AppearanceHost />
      </IdleThemeSync>
    </>
  )
}
