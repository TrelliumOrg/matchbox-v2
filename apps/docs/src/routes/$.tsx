import { manifest } from "@matchbox/docs/manifest"
import { siteOrigin } from "@matchbox/docs/site"
import { createFileRoute, notFound } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { warmBodies } from "../content/bodies"
import { hasPage, loadPage } from "../content/page-data"
import { DocPage } from "../shell/doc-page"
import pageTitle from "../shell/page-title"

/**
 * Every docs page but home, by path. The loader only warms the page's JSON
 * chunk (a static asset) so a client navigation shows the page whole, and
 * returns only the description for the head.
 */

function pathOf(splat: string | undefined): string {
  const trimmed = (splat ?? "").replace(/\/+$/, "")
  return trimmed === "" ? "/" : `/${trimmed}`
}

export const Route = createFileRoute("/$")({
  loader: async ({ params }) => {
    const path = pathOf(params._splat)
    if (!hasPage(path) || manifest.pages[path] === undefined) throw notFound()
    const page = await loadPage(path)
    await warmBodies(page)
    // Only the description, for the page's meta: nothing else is serialised.
    return { description: page.description }
  },
  head: ({ params, loaderData }) => {
    const page = manifest.pages[pathOf(params._splat)]
    if (page === undefined) return {}
    const url = `${siteOrigin}${page.path}`
    const title = pageTitle(page, manifest.pages)
    const description = loaderData?.description ?? ""
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    }
  },
  component: PageRoute,
})

function PageRoute(): ReactNode {
  const params = Route.useParams()
  const page = manifest.pages[pathOf(params._splat)]
  if (page === undefined) return null
  return <DocPage page={page} />
}
