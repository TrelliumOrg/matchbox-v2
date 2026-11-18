import { createFileRoute } from "@tanstack/react-router"
import NotFound from "../ui/not-found"

/**
 * Prerendered to /404.html, which the asset layer serves (with a 404
 * status) for every path no page matches. Not linked anywhere.
 */
export const Route = createFileRoute("/404")({
  head: () => ({
    meta: [
      { title: "Page not found, Matchbench" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotFound,
})
