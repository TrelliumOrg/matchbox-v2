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
        { name: "twitter:card", content: "summary" },
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
