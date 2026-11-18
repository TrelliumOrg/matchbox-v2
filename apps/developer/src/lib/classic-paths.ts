const classicAppTabs: Record<string, string> = {
  keys: "keys",
  secrets: "secrets",
  environments: "environment",
  oauth: "oauth",
  settings: "settings",
  usage: "usage",
}

/**
 * Classic's per-tab app paths (`/apps/{id}/keys`) are now one page with a
 * `?tab=`: old bookmarks and links keep working. Null for every other path.
 */
export function classicAppRedirect(url: URL): Response | null {
  const match = /^\/apps\/([0-9a-fA-F-]{36})\/([a-z]+)\/?$/.exec(url.pathname)
  const app = match?.[1]
  const tab = match?.[2] === undefined ? undefined : classicAppTabs[match[2]]
  if (app === undefined || tab === undefined) return null
  const target = new URL(`/apps/${app}`, url)
  target.search = url.search
  target.searchParams.set("tab", tab)
  return new Response(null, {
    status: 301,
    headers: { location: `${target.pathname}${target.search}` },
  })
}
