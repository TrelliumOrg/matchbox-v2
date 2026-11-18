import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { GaugePicture, sizedPictureUrl } from "./picture"

const stored =
  "https://ref.supabase.co/storage/v1/object/public/gauge-avatars/0xabc.jpg"

describe("sizedPictureUrl", () => {
  it("asks Supabase Storage for the picture at the size drawn", () => {
    expect(sizedPictureUrl(stored, 104)).toBe(
      "https://ref.supabase.co/storage/v1/render/image/public/gauge-avatars/0xabc.jpg?width=104&height=104&resize=cover",
    )
    expect(sizedPictureUrl(stored, 51.6)).toContain("width=52&height=52")
    expect(sizedPictureUrl(stored, 4)).toContain("width=16&height=16")
  })

  it("leaves every other URL as it is", () => {
    for (const url of [
      "https://example.org/logo.png",
      "/assets/btc.svg",
      `${stored}?v=2`,
      "https://ref.supabase.co/storage/v1/render/image/public/gauge-avatars/0xabc.jpg?width=52",
    ]) {
      expect(sizedPictureUrl(url, 52)).toBe(url)
    }
  })
})

describe("GaugePicture", () => {
  it("draws a stored picture at one and two device pixels, lazily", () => {
    const view = render(
      <GaugePicture picture={{ kind: "image", url: stored }} size={52} />,
    )
    const image = view.container.querySelector("img")
    expect(image?.getAttribute("src")).toContain("width=52&height=52")
    expect(image?.getAttribute("srcset")).toBe(
      `${sizedPictureUrl(stored, 52)} 1x, ${sizedPictureUrl(stored, 104)} 2x`,
    )
    expect(image?.getAttribute("loading")).toBe("lazy")
    expect(image?.getAttribute("width")).toBe("52")
    expect(image?.getAttribute("height")).toBe("52")
  })

  it("loads the page's main picture at once", () => {
    const view = render(
      <GaugePicture
        picture={{ kind: "image", url: stored }}
        size={104}
        priority
      />,
    )
    const image = view.container.querySelector("img")
    expect(image?.getAttribute("loading")).toBe("eager")
    expect(image?.getAttribute("fetchpriority")).toBe("high")
  })

  it("gives a picture it cannot resize no srcset", () => {
    const view = render(
      <GaugePicture
        picture={{ kind: "image", url: "https://example.org/logo.png" }}
      />,
    )
    const image = view.container.querySelector("img")
    expect(image?.getAttribute("src")).toBe("https://example.org/logo.png")
    expect(image?.hasAttribute("srcset")).toBe(false)
  })

  it("draws the card's cached picture underneath a larger one", () => {
    const view = render(
      <GaugePicture
        picture={{ kind: "image", url: stored }}
        size={104}
        priority
        placeholderSize={52}
        transitionName="gauge-0xabc"
      />,
    )
    const images = view.container.querySelectorAll("img")
    expect(images).toHaveLength(2)
    const [under, over] = [...images]
    // The very URLs a 52px card asks for, so the browser reuses its copy.
    expect(under?.getAttribute("srcset")).toBe(
      `${sizedPictureUrl(stored, 52)} 1x, ${sizedPictureUrl(stored, 104)} 2x`,
    )
    expect(under?.getAttribute("aria-hidden")).toBe("true")
    expect(under?.getAttribute("loading")).toBe("eager")
    expect(over?.getAttribute("srcset")).toBe(
      `${sizedPictureUrl(stored, 104)} 1x, ${sizedPictureUrl(stored, 208)} 2x`,
    )
    // One element moves in the view transition: the frame holding both.
    const frame = view.container.firstElementChild
    expect(frame?.getAttribute("style")).toContain("view-transition-name")
    expect(under?.getAttribute("style") ?? "").not.toContain(
      "view-transition-name",
    )
    expect(over?.getAttribute("style") ?? "").not.toContain(
      "view-transition-name",
    )
  })

  it("draws one image when there is nothing cached to show", () => {
    const view = render(
      <GaugePicture picture={{ kind: "image", url: stored }} size={104} />,
    )
    expect(view.container.querySelectorAll("img")).toHaveLength(1)
  })
})
