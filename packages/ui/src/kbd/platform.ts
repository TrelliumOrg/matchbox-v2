/**
 * Which modifier a shortcut hint shows: ⌘ on macOS and iOS, ctrl elsewhere.
 * The server decides from the request (Sec-CH-UA-Platform, else the
 * User-Agent) and stamps `<html data-platform>`, so the first paint shows
 * the right cap with no JavaScript; `syncPlatform` confirms it in the
 * browser from navigator.userAgentData or navigator.platform.
 */

export type Platform = "mac" | "other"

export const platformAttribute = "data-platform"

/** Ask Chromium for the platform hint on later requests. */
export const platformHintHeaders = {
  "accept-ch": "Sec-CH-UA-Platform",
  vary: "Sec-CH-UA-Platform",
} as const

const applePlatform = /mac|iphone|ipad|ipod|ios/i

export function platformFromHeaders(headers: {
  get: (name: string) => string | null
}): Platform {
  const hint = headers.get("sec-ch-ua-platform")
  if (hint !== null && hint !== "") {
    return applePlatform.test(hint) ? "mac" : "other"
  }
  const agent = headers.get("user-agent") ?? ""
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(agent) ? "mac" : "other"
}

type NavigatorLike = {
  platform?: string
  userAgentData?: { platform?: string } | undefined
}

export function platformFromNavigator(nav: NavigatorLike): Platform {
  const name = nav.userAgentData?.platform || nav.platform || ""
  return applePlatform.test(name) ? "mac" : "other"
}

/** Corrects the server's guess once, in the browser. */
export function syncPlatform(
  root: HTMLElement = document.documentElement,
  nav: NavigatorLike = navigator as NavigatorLike,
): Platform {
  const platform = platformFromNavigator(nav)
  if (root.getAttribute(platformAttribute) !== platform) {
    root.setAttribute(platformAttribute, platform)
  }
  return platform
}
