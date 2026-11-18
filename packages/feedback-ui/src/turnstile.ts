/**
 * Cloudflare Turnstile, loaded with the panel (never on first paint) and
 * rendered inside it: no pop-up, no new tab. Its check shows only when
 * Turnstile asks for an interaction ("Bot check shown"); otherwise it runs
 * unseen and hands over a token. A token is good for one report, so the
 * widget is reset after every send.
 */

const scriptUrl =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

export type TurnstileOptions = {
  sitekey: string
  action: string
  theme: "light" | "dark"
  appearance: "interaction-only"
  size: "flexible"
  "refresh-expired": "auto"
  "response-field": false
  callback: (token: string) => void
  "error-callback": () => void
  "expired-callback": () => void
  "before-interactive-callback": () => void
  "after-interactive-callback": () => void
}

export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileOptions): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

/** `window.turnstile`, checked before use rather than cast. */
export function turnstileApi(value: unknown): TurnstileApi | null {
  if (typeof value !== "object" || value === null) return null
  const render: unknown = Reflect.get(value, "render")
  const reset: unknown = Reflect.get(value, "reset")
  const remove: unknown = Reflect.get(value, "remove")
  if (
    typeof render !== "function" ||
    typeof reset !== "function" ||
    typeof remove !== "function"
  ) {
    return null
  }
  return {
    render: (container, options) => {
      const id: unknown = Reflect.apply(render, value, [container, options])
      return typeof id === "string" ? id : ""
    },
    reset: (widgetId) => {
      Reflect.apply(reset, value, [widgetId])
    },
    remove: (widgetId) => {
      Reflect.apply(remove, value, [widgetId])
    },
  }
}

let loading: Promise<TurnstileApi> | null = null

export function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const ready = turnstileApi(Reflect.get(window, "turnstile"))
    if (ready !== null) {
      resolve(ready)
      return
    }
    const script = document.createElement("script")
    script.src = scriptUrl
    script.async = true
    script.addEventListener("load", () => {
      const api = turnstileApi(Reflect.get(window, "turnstile"))
      if (api === null) reject(new Error("Turnstile did not start"))
      else resolve(api)
    })
    script.addEventListener("error", () => {
      reject(new Error("Turnstile did not load"))
    })
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}
