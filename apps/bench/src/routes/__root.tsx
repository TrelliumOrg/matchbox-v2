import figtreeLatin from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url"
import { rootHead, ShellEnd, ThemeColor } from "@matchbox/app-kit/root-document"
import { themeScript } from "@matchbox/tokens"
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import results from "../data/results"
import { ogImage, robotsMeta, siteDescription } from "../data/site"
import appCss from "../styles.css?url"
import NotFound from "../ui/not-found"
import { Shell } from "../ui/shell"

/**
 * The document every page is prerendered into. One inline script runs
 * before paint: the theme from @matchbox/tokens, which reads the shared
 * Appearance choice, so a theme picked in Pro or Matchscan shows here with
 * no flash. The CSP allows it by hash (scripts/postbuild.mjs).
 */
function BenchDocument({ children }: { children: ReactNode }): ReactNode {
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
      title: "Matchbench",
      description: siteDescription,
      font: figtreeLatin,
      stylesheet: appCss,
    })
    return {
      meta: [
        ...base.meta,
        // noindex while the figures are a sample (and X-Robots-Tag, added
        // by scripts/postbuild.mjs).
        ...robotsMeta(results.run),
        { property: "og:site_name", content: "Matchbench" },
        { property: "og:type", content: "website" },
        { property: "og:description", content: siteDescription },
        { property: "og:image", content: ogImage },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        {
          property: "og:image:alt",
          content: "Matchbench: which model answers Mezo questions best?",
        },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: base.links,
    }
  },
  shellComponent: BenchDocument,
  component: RootComponent,
  notFoundComponent: NotFound,
})

function RootComponent(): ReactNode {
  return (
    <>
      <Shell>
        <Outlet />
      </Shell>
      <ShellEnd />
    </>
  )
}
