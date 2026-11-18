import { render, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  Kbd,
  platformFromHeaders,
  platformFromNavigator,
  syncPlatform,
} from "./index"

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null }
}

describe("platform", () => {
  it("reads the client hint first, then the user agent", () => {
    expect(
      platformFromHeaders(headers({ "sec-ch-ua-platform": '"macOS"' })),
    ).toBe("mac")
    expect(
      platformFromHeaders(headers({ "sec-ch-ua-platform": '"Windows"' })),
    ).toBe("other")
    expect(
      platformFromHeaders(
        headers({
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        }),
      ),
    ).toBe("mac")
    expect(
      platformFromHeaders(
        headers({
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
        }),
      ),
    ).toBe("other")
    expect(platformFromHeaders(headers({}))).toBe("other")
  })

  it("confirms in the browser from userAgentData or platform", () => {
    expect(
      platformFromNavigator({ userAgentData: { platform: "macOS" } }),
    ).toBe("mac")
    expect(platformFromNavigator({ platform: "MacIntel" })).toBe("mac")
    expect(platformFromNavigator({ platform: "iPad" })).toBe("mac")
    expect(platformFromNavigator({ platform: "Win32" })).toBe("other")
    expect(
      platformFromNavigator({
        userAgentData: { platform: "" },
        platform: "Linux x86_64",
      }),
    ).toBe("other")
    const root = document.createElement("html")
    root.setAttribute("data-platform", "other")
    expect(syncPlatform(root, { platform: "MacIntel" })).toBe("mac")
    expect(root.getAttribute("data-platform")).toBe("mac")
  })
})

describe("Kbd", () => {
  it("renders both mod caps for CSS to pick, then the key", () => {
    render(<Kbd keys={["mod", "k"]} />)
    expect(screen.getByLabelText("Command").dataset.kbdPlatform).toBe("mac")
    expect(screen.getByLabelText("Control").dataset.kbdPlatform).toBe("other")
    expect(screen.getByLabelText("K").textContent).toBe("K")
  })

  it("names arrows and enter for screen readers", () => {
    const html = renderToString(<Kbd keys={["up", "down", "enter"]} />)
    expect(html).toContain('aria-label="Up arrow"')
    expect(html).toContain('aria-label="Enter"')
  })
})
