import figtreeLatin from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url"
import {
  IdleThemeSync,
  rootHead,
  ShellEnd,
  ThemeColor,
} from "@matchbox/app-kit/root-document"
import { siteOrigin } from "@matchbox/docs/site"
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
 * The link preview card every page shares, 1200x630, drawn by packages/og
 * (`pnpm --filter @matchbox/og cards`) into public/og.png. Pages set their
 * own og:title, og:description and og:url (routes/$.tsx, routes/index.tsx).
 */
const ogImage = `${siteOrigin}/og.png`

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
        { property: "og:title", content: "Matchbox Docs" },
        { property: "og:description", content: description },
        { property: "og:image", content: ogImage },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        {
          property: "og:image:alt",
          content: "Matchbox Docs: learn Matchbox",
        },
        { name: "twitter:card", content: "summary_large_image" },
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
