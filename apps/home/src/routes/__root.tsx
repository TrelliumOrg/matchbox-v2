import figtreeLatin from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url"
import {
  RootDocument,
  rootHead,
  ShellEnd,
} from "@matchbox/app-kit/root-document"
import { createRootRoute, Outlet } from "@tanstack/react-router"
import type { ReactNode } from "react"
import appCss from "../styles.css?url"

const description =
  "Matchbox Pro, Matchscan, Matchbox ID and Developer: apps for Mezo."

const origin = "https://matchbox.markets"

/**
 * The link preview card, 1200x630, drawn by packages/og
 * (`pnpm --filter @matchbox/og cards`) into public/og.png.
 */
const ogImage = `${origin}/og.png`

export const Route = createRootRoute({
  head: () => {
    const base = rootHead({
      title: "Matchbox",
      description,
      font: figtreeLatin,
      stylesheet: appCss,
    })
    return {
      meta: [
        ...base.meta,
        { property: "og:site_name", content: "Matchbox" },
        { property: "og:type", content: "website" },
        { property: "og:title", content: "Matchbox" },
        { property: "og:description", content: description },
        { property: "og:url", content: `${origin}/` },
        { property: "og:image", content: ogImage },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        {
          property: "og:image:alt",
          content: "Matchbox: use Mezo with Matchbox",
        },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [...base.links, { rel: "canonical", href: `${origin}/` }],
    }
  },
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent(): ReactNode {
  return (
    <>
      <Outlet />
      <ShellEnd />
    </>
  )
}
