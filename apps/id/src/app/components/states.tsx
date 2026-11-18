import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

const titles: Record<string, string> = {
  invalid_client: "Unknown app",
  invalid_redirect_uri: "Redirect not registered",
  invalid_request: "Invalid request",
  invalid_scope: "Invalid scope",
  unsupported_response_type: "Unsupported request",
  access_denied: "Access denied",
  login_required: "Sign-in required",
  consent_required: "Consent required",
  request_expired: "Request expired",
  service_disabled: "Matchbox ID unavailable",
  temporarily_unavailable: "Temporarily unavailable",
  server_error: "Something went wrong",
  not_found: "Not found",
}

export function errorTitle(code: string): string {
  return titles[code] ?? "Sign-in error"
}

/**
 * Terse error page (Error `ynCjcUdHJx`): an icon, the title, the machine
 * code in mono and one way out. `back` returns to the app when one is known.
 */
export function ErrorState({
  code,
  back,
}: {
  code: string
  back?: { label: string; href: string }
}): ReactNode {
  return (
    <section
      aria-labelledby="error-title"
      className="mx-auto flex w-full max-w-[480px] flex-col items-start pt-[116px] max-md:pt-10"
    >
      <span className="grid size-12 place-items-center rounded-full bg-soft text-ink">
        <Icon
          name={code === "request_expired" ? "clock" : "x"}
          size={20}
          strokeWidth={1.8}
        />
      </span>
      <h1
        id="error-title"
        className="mt-5 text-[32px] font-[650] leading-[1.15] tracking-[-0.02em] text-ink"
      >
        {errorTitle(code)}
      </h1>
      <p className="mt-2.5 font-mono text-[13px] text-sec">{code}</p>
      {code === "service_disabled" ? null : (
        <div className="mt-7 flex flex-wrap gap-3">
          {back === undefined ? null : (
            <PillButton.Root asChild>
              <a href={back.href}>{back.label}</a>
            </PillButton.Root>
          )}
          <PillButton.Root
            asChild
            intent={back === undefined ? "primary" : "secondary"}
          >
            <Link to="/">Account</Link>
          </PillButton.Root>
        </div>
      )}
    </section>
  )
}

export function ErrorView(): ReactNode {
  return <ErrorState code="server_error" />
}

export function NotFoundView(): ReactNode {
  return <ErrorState code="not_found" />
}
