import { whenIdle } from "@matchbox/motion"
import { themeScript } from "@matchbox/tokens"
import { lockupFoldScript } from "@matchbox/ui/lockup"
import { HeadContent, Scripts, useRouter } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react"

/**
 * The document every Matchbox frontend renders around its routes: the
 * pre-paint theme and lockup fold scripts, the head, and the render-blocking
 * shell gate. Errors in the root loader still render inside it.
 */

/**
 * The root route's head holds `<link rel="expect" href="#shell-end"
 * blocking="render">`: Chromium paints nothing until the parser reaches this
 * marker. Without it a slow device can paint streamed HTML halfway through
 * the top bar or a row, and the rest arriving moves what it painted: CLS
 * above 0. Render `<ShellEnd />` after the shell's last element.
 */
export const shellEndId = "shell-end"

export function ShellEnd(): ReactNode {
  return <span id={shellEndId} hidden />
}

export type RootHeadOptions = {
  title: string
  description: string
  /** The latin Figtree file's URL (`…/figtree-latin-wght-normal.woff2?url`). */
  font: string
  /** The app's stylesheet URL (`../styles.css?url`). */
  stylesheet: string
  icon?: string
}

export type ThemeColors = { light: string; dark: string }

export const defaultThemeColors: ThemeColors = {
  light: "#ffffff",
  dark: "#121212",
}

type HeadMeta = Record<string, string>
type HeadLink = Record<string, string>

/** The root route's `head()`: meta, the font preload, styles, the gate. */
export function rootHead(options: RootHeadOptions): {
  meta: HeadMeta[]
  links: HeadLink[]
} {
  return {
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: options.title },
      { name: "description", content: options.description },
    ],
    links: [
      {
        rel: "preload",
        href: options.font,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: options.stylesheet },
      // First paint waits for the whole shell: see ShellEnd.
      { rel: "expect", href: `#${shellEndId}`, blocking: "render" },
      {
        rel: "icon",
        href: options.icon ?? "/favicon.svg",
        type: "image/svg+xml",
      },
    ],
  }
}

/**
 * Both `theme-color` metas, one per scheme. Rendered by the document, not
 * through `head()`: HeadContent keeps one meta per `name`, so the light one
 * was dropped. They are what a page with scripting off shows: the theme
 * script puts a theme-color meta of its own first in <head> (the first
 * match wins), set to the chosen preset's background, and every later theme
 * change updates it, so the browser bar follows the Appearance choice.
 */
export function ThemeColor({
  colors = defaultThemeColors,
}: {
  colors?: ThemeColors
}): ReactNode {
  return (
    <>
      <meta
        name="theme-color"
        content={colors.light}
        media="(prefers-color-scheme: light)"
      />
      <meta
        name="theme-color"
        content={colors.dark}
        media="(prefers-color-scheme: dark)"
      />
    </>
  )
}

/**
 * The document. Pass as the root route's `shellComponent`. The inline
 * scripts carry the router's `ssr.nonce` (this response's CSP nonce, see
 * ./security), so a strict script-src allows them.
 */
export function RootDocument({ children }: { children: ReactNode }): ReactNode {
  const nonce = useRouter().options.ssr?.nonce
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeColor />
        <script
          suppressHydrationWarning
          nonce={nonce}
          // The script already ran: the client keeps it without shipping it.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-paint theme from @matchbox/tokens
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? themeScript : "",
          }}
        />
        <script
          suppressHydrationWarning
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the lockup starts folded when this session already folded it
          dangerouslySetInnerHTML={{
            __html: import.meta.env.SSR ? lockupFoldScript : "",
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

const ThemeSync = lazy(() => import("./theme-sync"))

/**
 * Mounts the ThemeProvider once the page is idle (see theme-sync).
 * `children` render inside it, for an app's Appearance sheet.
 */
export function IdleThemeSync({
  children,
}: {
  children?: ReactNode
}): ReactNode {
  const [ready, setReady] = useState(false)
  useEffect(() => whenIdle(() => setReady(true)), [])
  if (!ready) return null
  return (
    <Suspense fallback={null}>
      <ThemeSync>{children}</ThemeSync>
    </Suspense>
  )
}
