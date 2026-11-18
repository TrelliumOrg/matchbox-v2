import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  type Appearance,
  appearanceCookie,
  appearanceStorageKeys,
  applyPreset,
  colorSchemes,
  darkPresets,
  defaultAppearance,
  lightPresets,
  parseAppearanceCookie,
  presetBackgrounds,
  presetMode,
  presets,
  readAppearance,
  resolvePreset,
  type ThemePreset,
  themeColorMarker,
  themeScript,
  writeAppearance,
} from "./index"

const css = readFileSync(
  fileURLToPath(new URL("./themes.css", import.meta.url)),
  "utf8",
)

function cssBlock(preset: ThemePreset): Map<string, string> {
  const match = css.match(
    new RegExp(`\\[data-theme="${preset}"\\]\\s*\\{([^}]*)\\}`),
  )
  if (match === null) throw new Error(`No block for ${preset}`)
  const vars = new Map<string, string>()
  for (const [, name, value] of (match[1] ?? "").matchAll(
    /--([A-Za-z0-9]+):\s*([^;]+);/g,
  )) {
    if (name !== undefined && value !== undefined) vars.set(name, value.trim())
  }
  return vars
}

function memoryStorage(entries: Record<string, string>): Storage {
  const data = new Map(Object.entries(entries))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

describe("presets", () => {
  it.each([...lightPresets, ...darkPresets])(
    "the theme-color background matches the palette for %s",
    (preset) => {
      expect(presetBackgrounds[preset]).toBe(presets[preset].palette.bg)
    },
  )

  it("has four light and four dark presets", () => {
    expect(lightPresets).toEqual(["paper", "linen", "concrete", "porcelain"])
    expect(darkPresets).toEqual(["graphite", "walnut", "slate", "onyx"])
  })

  it.each([...lightPresets, ...darkPresets])(
    "themes.css matches the TS constants for %s",
    (preset) => {
      const vars = cssBlock(preset)
      const palette: Record<string, string> = presets[preset].palette
      for (const [token, hex] of Object.entries(palette)) {
        expect(vars.get(token)?.toLowerCase(), token).toBe(hex.toLowerCase())
      }
      expect(vars.size).toBe(Object.keys(palette).length)
    },
  )

  it("names each preset's mode without reading the palettes", () => {
    for (const preset of [...lightPresets, ...darkPresets]) {
      expect(presetMode(preset)).toBe(presets[preset].mode)
    }
  })

  it("keeps the guideline's fixed colours in every preset", () => {
    for (const preset of [...lightPresets, ...darkPresets]) {
      expect(presets[preset].palette.onMezo).toBe("#FFFFFF")
    }
    for (const preset of [...lightPresets, ...darkPresets]) {
      const { palette } = presets[preset]
      expect(palette.acc).toBe("#F7931A")
      expect(palette.onAcc).toBe("#1A1206")
    }
    expect(presets.paper.palette.mezo).toBe("#D23A61")
    expect(presets.graphite.palette.mezo).toBe("#C7365C")
    expect(presets.slate.palette.mezo).toBe("#C9395F")
  })

  it("matches the guideline grounds", () => {
    expect(presets.paper.palette.bg).toBe("#FFFFFF")
    expect(presets.linen.palette.bg).toBe("#FAF7F2")
    expect(presets.concrete.palette.bg).toBe("#F6F7F8")
    expect(presets.porcelain.palette.bg).toBe("#FFFFFF")
    expect(presets.graphite.palette.bg).toBe("#121212")
    expect(presets.walnut.palette.bg).toBe("#16130F")
    expect(presets.slate.palette.bg).toBe("#0F1216")
    expect(presets.onyx.palette.bg).toBe("#000000")
  })
})

describe("appearance", () => {
  it("defaults to System, Paper, Graphite", () => {
    expect(readAppearance(null)).toEqual({
      mode: "system",
      light: "paper",
      dark: "graphite",
    })
    expect(readAppearance(memoryStorage({}))).toEqual(defaultAppearance)
  })

  it("falls back per field on invalid values", () => {
    const storage = memoryStorage({
      [appearanceStorageKeys.mode]: "dark",
      [appearanceStorageKeys.light]: "graphite",
      [appearanceStorageKeys.dark]: "onyx",
    })
    expect(readAppearance(storage)).toEqual({
      mode: "dark",
      light: "paper",
      dark: "onyx",
    })
  })

  it("survives storage that throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked")
      },
    }
    expect(readAppearance(storage)).toEqual(defaultAppearance)
    const failing = {
      setItem: () => {
        throw new Error("quota")
      },
    }
    expect(writeAppearance(failing, defaultAppearance)).toBe(false)
  })

  it("round-trips through storage", () => {
    const storage = memoryStorage({})
    const appearance: Appearance = {
      mode: "light",
      light: "linen",
      dark: "slate",
    }
    expect(writeAppearance(storage, appearance)).toBe(true)
    expect(readAppearance(storage)).toEqual(appearance)
  })

  it("resolves the preset from mode and device preference", () => {
    const appearance: Appearance = {
      mode: "system",
      light: "concrete",
      dark: "walnut",
    }
    expect(resolvePreset(appearance, false)).toBe("concrete")
    expect(resolvePreset(appearance, true)).toBe("walnut")
    expect(resolvePreset({ ...appearance, mode: "light" }, true)).toBe(
      "concrete",
    )
    expect(resolvePreset({ ...appearance, mode: "dark" }, false)).toBe("walnut")
  })
})

describe("appearance cookie", () => {
  const appearance: Appearance = {
    mode: "dark",
    light: "linen",
    dark: "onyx",
  }

  it("is shared by every matchbox.markets product for a year", () => {
    expect(appearanceCookie(appearance)).toBe(
      "mbx-appearance=dark.linen.onyx; Domain=.matchbox.markets; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    )
  })

  it("reads back among other cookies", () => {
    expect(
      parseAppearanceCookie("a=1; mbx-appearance=dark.linen.onyx; b=2"),
    ).toEqual(appearance)
    expect(parseAppearanceCookie("a=1")).toBeNull()
    expect(parseAppearanceCookie("")).toBeNull()
  })

  it("accepts only known values in all three parts", () => {
    for (const value of [
      "bogus.linen.onyx",
      "dark.onyx.onyx",
      "dark.linen.paper",
      "dark.linen",
      "dark.linen.onyx.extra",
      "",
    ]) {
      expect(parseAppearanceCookie(`mbx-appearance=${value}`)).toBeNull()
    }
  })

  it("wins over the stored copy, which covers a bad cookie", () => {
    const storage = memoryStorage({
      [appearanceStorageKeys.mode]: "light",
      [appearanceStorageKeys.light]: "concrete",
      [appearanceStorageKeys.dark]: "walnut",
    })
    expect(readAppearance(storage, "mbx-appearance=dark.linen.onyx")).toEqual(
      appearance,
    )
    expect(readAppearance(null, "mbx-appearance=dark.linen.onyx")).toEqual(
      appearance,
    )
    expect(readAppearance(storage, "mbx-appearance=dark.linen.nope")).toEqual({
      mode: "light",
      light: "concrete",
      dark: "walnut",
    })
  })

  it("is set on write, even when storage is missing or throws", () => {
    const jar = { cookie: "" }
    expect(writeAppearance(memoryStorage({}), appearance, jar)).toBe(true)
    expect(jar.cookie).toBe(appearanceCookie(appearance))
    const second = { cookie: "" }
    expect(writeAppearance(null, appearance, second)).toBe(false)
    expect(second.cookie).toBe(appearanceCookie(appearance))
    const refusing = {
      set cookie(_value: string) {
        throw new Error("sandboxed")
      },
      get cookie(): string {
        return ""
      },
    }
    expect(writeAppearance(memoryStorage({}), appearance, refusing)).toBe(true)
  })
})

describe("themeScript", () => {
  function runScript(
    entries: Record<string, string> | "throws",
    prefersDark: boolean,
    cookie: string | "throws" = "",
  ): string | null {
    let theme: string | null = null
    const document = {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          if (name === "data-theme") theme = value
        },
      },
      get cookie(): string {
        if (cookie === "throws") throw new Error("sandboxed")
        return cookie
      },
    }
    const window = {
      localStorage:
        entries === "throws"
          ? {
              getItem: () => {
                throw new Error("blocked")
              },
            }
          : memoryStorage(entries),
      matchMedia: () => ({ matches: prefersDark }),
    }
    new Function("document", "window", themeScript)(document, window)
    return theme
  }

  const values = {
    mode: [...colorSchemes, "bogus", null],
    light: [...lightPresets, "onyx", null],
    dark: [...darkPresets, "paper", null],
  }

  it("matches readAppearance and resolvePreset for every stored combination", () => {
    for (const mode of values.mode) {
      for (const light of values.light) {
        for (const dark of values.dark) {
          for (const prefersDark of [false, true]) {
            const entries: Record<string, string> = {}
            if (mode !== null) entries[appearanceStorageKeys.mode] = mode
            if (light !== null) entries[appearanceStorageKeys.light] = light
            if (dark !== null) entries[appearanceStorageKeys.dark] = dark
            const expected = resolvePreset(
              readAppearance(memoryStorage(entries)),
              prefersDark,
            )
            expect(runScript(entries, prefersDark)).toBe(expected)
          }
        }
      }
    }
  })

  it("paints Paper when storage throws", () => {
    expect(runScript("throws", true)).toBe("paper")
  })

  it("matches readAppearance for every cookie, over any stored copy", () => {
    const stored = {
      [appearanceStorageKeys.mode]: "light",
      [appearanceStorageKeys.light]: "concrete",
      [appearanceStorageKeys.dark]: "walnut",
    }
    for (const mode of [...colorSchemes, "bogus"]) {
      for (const light of [...lightPresets, "onyx"]) {
        for (const dark of [...darkPresets, "paper"]) {
          for (const prefersDark of [false, true]) {
            for (const cookie of [
              `mbx-appearance=${mode}.${light}.${dark}`,
              `a=1; mbx-appearance=${mode}.${light}.${dark}; b=2`,
              `mbx-appearance=${mode}.${light}.${dark}.extra`,
              `xmbx-appearance=${mode}.${light}.${dark}`,
            ]) {
              const expected = resolvePreset(
                readAppearance(memoryStorage(stored), cookie),
                prefersDark,
              )
              expect(runScript(stored, prefersDark, cookie)).toBe(expected)
            }
          }
        }
      }
    }
  })

  it("rejects a cookie whose separators are not dots", () => {
    const stored = {
      [appearanceStorageKeys.mode]: "light",
      [appearanceStorageKeys.light]: "concrete",
      [appearanceStorageKeys.dark]: "walnut",
    }
    for (const value of [
      "dark-linen-onyx",
      "dark linen onyx",
      "dark.linen-onyx",
      "dark_linen.onyx",
      "darkxlinenxonyx",
    ]) {
      const cookie = `mbx-appearance=${value}`
      expect(parseAppearanceCookie(cookie), value).toBeNull()
      expect(runScript(stored, true, cookie), value).toBe("concrete")
    }
    expect(themeScript).toContain("[.]")
    expect(themeScript).not.toMatch(/\)\.\(/)
  })

  it("paints from the cookie when storage throws, and the reverse", () => {
    expect(runScript("throws", false, "mbx-appearance=dark.linen.onyx")).toBe(
      "onyx",
    )
    expect(
      runScript({ [appearanceStorageKeys.mode]: "dark" }, false, "throws"),
    ).toBe("graphite")
  })

  it("puts its own theme-color meta first, at the painted background", () => {
    const page = fakeDocument()
    const document = {
      ...page,
      documentElement: { setAttribute: () => undefined },
      cookie: "mbx-appearance=light.linen.onyx",
    }
    const window = {
      localStorage: memoryStorage({}),
      matchMedia: () => ({ matches: true }),
    }
    new Function("document", "window", themeScript)(document, window)
    expect(page.head.children).toHaveLength(1)
    expect(page.head.children[0]).toMatchObject({
      id: themeColorMarker,
      name: "theme-color",
      content: "#FAF7F2",
    })
  })

  it("still paints when the theme-color metas cannot be reached", () => {
    expect(runScript({}, true)).toBe("graphite")
  })

  it("stays small enough to inline", () => {
    expect(themeScript.length).toBeLessThan(1000)
  })
})

describe("applyPreset", () => {
  it("sets data-theme and the page's own theme-color meta", () => {
    const attributes = new Map<string, string>()
    const page = fakeDocument()
    const root = {
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      ownerDocument: page,
    } as unknown as HTMLElement
    applyPreset(root, "slate")
    applyPreset(root, "linen")
    expect(attributes.get("data-theme")).toBe("linen")
    expect(page.head.children).toHaveLength(1)
    expect(page.head.children[0]?.content).toBe("#FAF7F2")
  })
})

/** A <head> with insertBefore, and getElementById for its children. */
function fakeDocument() {
  type Element = {
    id: string
    content: string
    name: string
    setAttribute: (name: string, value: string) => void
  }
  const children: Element[] = []
  const head = {
    children,
    get firstChild(): Element | null {
      return children[0] ?? null
    },
    insertBefore: (node: Element) => {
      children.unshift(node)
    },
  }
  return {
    head,
    getElementById: (id: string): Element | null =>
      children.find((child) => child.id === id) ?? null,
    createElement: (): Element => {
      const element: Element = {
        id: "",
        content: "",
        name: "",
        setAttribute: (name, value) => {
          if (name === "name") element.name = value
        },
      }
      return element
    },
  }
}
