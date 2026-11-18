import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { FeedbackOptions } from "./entry"
import { FeedbackEntry } from "./entry"
import { FeedbackPanel } from "./panel"
import { getSession, openPanel } from "./store"

const endpoint = "https://feedback.matchbox.test"
const address = "0x5Dc2000000000000000000000000000000071aF0"

let container: HTMLElement

type Call = { url: string; init: RequestInit | undefined }
let calls: Call[] = []

function workerFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  calls.push({ url, init })
  if (url.endsWith("/v1/config")) {
    return Promise.resolve(Response.json({ turnstileSiteKey: "site-key" }))
  }
  if (url.endsWith("/v1/reports")) {
    return Promise.resolve(
      Response.json(
        {
          id: "0123456789abcdef0123456789abcdef",
          reference: "FB-7K3Q2M",
          upload: null,
        },
        { status: 201 },
      ),
    )
  }
  return Promise.resolve(new Response("not found", { status: 404 }))
}

beforeEach(() => {
  calls = []
  container = document.createElement("div")
  container.setAttribute("data-feedback-root", "")
  document.body.append(container)
  vi.stubGlobal("fetch", vi.fn(workerFetch))
  // Turnstile passes at once, unseen, as it does for most people.
  vi.stubGlobal("turnstile", {
    render: (
      _element: HTMLElement,
      options: { callback: (token: string) => void },
    ) => {
      setTimeout(() => options.callback("turnstile-token"), 0)
      return "widget-1"
    },
    reset: () => undefined,
    remove: () => undefined,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  container.remove()
})

function open(options: Partial<FeedbackOptions> = {}) {
  render(<FeedbackPanel container={container} />)
  act(() => {
    openPanel({ endpoint, surface: "pro", ...options })
  })
  return screen.getByRole("dialog", { name: "Send feedback" })
}

describe("the feedback panel", () => {
  it("opens as a labelled dialog with the message field focused", () => {
    open()
    const message = screen.getByLabelText("What went wrong?")
    expect(message).toHaveProperty(
      "placeholder",
      "What did you expect, and what happened?",
    )
    expect(document.activeElement).toBe(message)
    expect(screen.getByRole("group", { name: "Type" })).toBeTruthy()
    expect(screen.getByRole("radio", { name: "Bug" })).toHaveProperty(
      "checked",
      true,
    )
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy()
  })

  it("lists what is sent, and the page can be removed", async () => {
    const user = userEvent.setup()
    open()
    const list = screen.getByRole("heading", { name: "Sent with this report" })
    expect(list).toBeTruthy()
    expect(screen.getByText("Page")).toBeTruthy()
    expect(screen.getByText("Browser")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Remove page" }))
    expect(screen.queryByText("Page")).toBeNull()
    expect(getSession().state.draft.includePage).toBe(false)
  })

  it("keeps Send unavailable until the message has 3 characters", async () => {
    const user = userEvent.setup()
    open()
    const send = screen.getByRole("button", { name: "Send report" })
    expect(send.getAttribute("aria-disabled")).toBe("true")
    await user.type(screen.getByLabelText("What went wrong?"), "abc")
    expect(send.getAttribute("aria-disabled")).toBe("false")
  })

  it("closes on Escape and keeps the draft for next time", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText("What went wrong?"), "Half typed")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    act(() => {
      openPanel({ endpoint, surface: "pro" })
    })
    expect(screen.getByLabelText("What went wrong?")).toHaveProperty(
      "value",
      "Half typed",
    )
  })

  it("offers the wallet address only behind an unticked box", async () => {
    const user = userEvent.setup()
    open({ wallet: () => ({ address, chainId: 31612 }) })
    const box = screen.getByRole("checkbox", {
      name: /Include my wallet address/,
    })
    expect(box).toHaveProperty("checked", false)
    expect(screen.queryByText("Wallet")).toBeNull()
    expect(screen.getAllByText("0x5Dc2…1aF0")).toHaveLength(1)
    await user.click(box)
    expect(screen.getByText("Wallet")).toBeTruthy()
    expect(screen.getByText("31612")).toBeTruthy()
  })

  it("keeps the connected wallet's address out of the page", () => {
    window.history.replaceState(null, "", `/${address.toLowerCase()}/vote`)
    try {
      open({ wallet: () => ({ address, chainId: 31612 }) })
      expect(getSession().context?.route).toBe("/:wallet/vote")
    } finally {
      window.history.replaceState(null, "", "/")
    }
  })

  it("offers no screenshot while a signing review is open, and says why", () => {
    open({ screenshotBlocked: () => "A signing review is open" })
    expect(screen.getByText("No screenshots on this screen")).toBeTruthy()
    expect(screen.getByText("A signing review is open")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Take screenshot" })).toBeNull()
    expect(screen.queryByText("Attach an image")).toBeNull()
  })

  it("honours a page marked no-capture", () => {
    const marked = document.createElement("section")
    marked.setAttribute("data-feedback", "no-capture")
    marked.setAttribute("data-feedback-reason", "It shows a secret key")
    document.body.append(marked)
    try {
      open()
      expect(screen.getByText("It shows a secret key")).toBeTruthy()
    } finally {
      marked.remove()
    }
  })

  it("sends the report and shows its reference", async () => {
    const user = userEvent.setup()
    open({ wallet: () => ({ address, chainId: 31612 }) })
    await user.type(
      screen.getByLabelText("What went wrong?"),
      "Claim all fails in OKX Wallet",
    )
    await user.click(
      screen.getByRole("button", { name: "Add how to reach you" }),
    )
    await user.type(
      screen.getByLabelText("How can we reach you? Optional"),
      "pyke on Discord",
    )
    await user.click(screen.getByRole("button", { name: "Send report" }))
    expect(
      await screen.findByRole("dialog", { name: "Report sent" }),
    ).toBeTruthy()
    expect(screen.getByText("FB-7K3Q2M")).toBeTruthy()

    const post = calls.find((call) => call.url.endsWith("/v1/reports"))
    const body = z
      .object({
        message: z.string(),
        wallet: z.string().nullable(),
        contact: z.string().nullable(),
        turnstileToken: z.string(),
        screenshot: z.boolean(),
        context: z.object({ chainId: z.number().nullable() }),
      })
      .parse(JSON.parse(String(post?.init?.body)))
    expect(body).toMatchObject({
      message: "Claim all fails in OKX Wallet",
      wallet: null,
      contact: "pyke on Discord",
      turnstileToken: "turnstile-token",
      screenshot: false,
      context: { chainId: 31612 },
    })
  })
})

describe("FeedbackEntry", () => {
  it("renders nothing in a build without the Worker's URL", () => {
    const { container: host } = render(
      <FeedbackEntry endpoint={undefined} surface="pro">
        Feedback
      </FeedbackEntry>,
    )
    expect(host.innerHTML).toBe("")
  })

  it("opens the panel from a plain button", async () => {
    const user = userEvent.setup()
    render(
      <FeedbackEntry endpoint={endpoint} surface="scan" className="link">
        Feedback
      </FeedbackEntry>,
    )
    const entry = screen.getByRole("button", { name: "Feedback" })
    expect(entry.getAttribute("aria-haspopup")).toBe("dialog")
    expect(entry.hasAttribute("data-tap")).toBe(true)
    await user.click(entry)
    expect(
      await screen.findByRole("dialog", { name: "Send feedback" }),
    ).toBeTruthy()
    expect(getSession().context?.surface).toBe("scan")
  })

  it("gives focus back to the entry when the panel closes", async () => {
    const user = userEvent.setup()
    render(
      <FeedbackEntry endpoint={endpoint} surface="pro">
        Feedback
      </FeedbackEntry>,
    )
    const entry = screen.getByRole("button", { name: "Feedback" })
    await user.click(entry)
    await screen.findByRole("dialog", { name: "Send feedback" })
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.activeElement).toBe(entry)
  })
})
