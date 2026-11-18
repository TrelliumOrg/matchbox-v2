import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

/** The not-found page: prerendered to 404.html for every missing path. */
export default function NotFound(): ReactNode {
  return (
    <div className="pt-14 pb-10">
      <h1 className="text-[36px] font-[650] tracking-[-0.03em] text-ink md:text-[48px]">
        Page not found
      </h1>
      <p className="mt-4 text-[17px] text-ink2">
        Nothing lives at this address.{" "}
        <Link
          to="/"
          className="font-semibold text-ink underline decoration-mut underline-offset-4 hover:decoration-ink"
        >
          Back to the leaderboard
        </Link>
      </p>
    </div>
  )
}
