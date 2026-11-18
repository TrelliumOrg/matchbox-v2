import type { App } from "@matchbox/contracts/console"
import * as Avatar from "@matchbox/ui/avatar"
import { Icon } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { initials, nameHue } from "../lib/marks"

/** An app's logo or initials tile. */
export function AppMark({
  app,
  size = 48,
}: {
  app: Pick<App, "name" | "logoUrl">
  size?: number
}): ReactNode {
  if (app.logoUrl === null) {
    return (
      <Avatar.Root
        initials={initials(app.name)}
        hue={nameHue(app.name)}
        size={size}
        className="rounded-[14px]"
      />
    )
  }
  return (
    <img
      src={app.logoUrl}
      alt=""
      referrerPolicy="no-referrer"
      className="flex-none rounded-[14px] bg-soft object-cover"
      style={{ width: size, height: size }}
    />
  )
}

/** Which environments an app has: globe for live, flask for test. */
function EnvironmentIcons({ app }: { app: App }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 text-sec">
      {app.environments.map((environment) => (
        <span
          key={environment.id}
          title={environment.kind === "live" ? "Live" : "Test"}
        >
          <Icon
            name={environment.kind === "live" ? "globe" : "flask-conical"}
            size={16}
            strokeWidth={1.8}
          />
          <span className="sr-only">
            {environment.kind === "live" ? "Live" : "Test"}
          </span>
        </span>
      ))}
    </span>
  )
}

/** One app in a list: mark, name, slug, environments, and an aside. */
export function AppRow({
  app,
  aside,
}: {
  app: App
  aside: ReactNode
}): ReactNode {
  return (
    <li>
      <Link
        to="/apps/$appId"
        params={{ appId: app.id }}
        search={(current) =>
          current.org === undefined ? {} : { org: current.org }
        }
        className="flex min-h-[76px] items-center gap-4 rounded-[20px] px-2 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
      >
        <AppMark app={app} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[16px] font-semibold text-ink">
              {app.name}
            </span>
            <EnvironmentIcons app={app} />
          </span>
          <span className="block font-mono text-[13.5px] text-sec">
            {app.slug}
          </span>
        </span>
        {aside}
      </Link>
    </li>
  )
}
