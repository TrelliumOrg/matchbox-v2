import { createFileRoute, redirect } from "@tanstack/react-router"

/** Old link: connected apps are the account page's first tab. */
export const Route = createFileRoute("/apps")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true })
  },
})
