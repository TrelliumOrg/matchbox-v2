import { deflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import decodeAvatar from "./decode"
import { AvatarDecodeError, type PixelSample } from "./sample"

const limits = { maxPixels: 4096 * 4096 }
const orange = [0xf7, 0x93, 0x1a] as const
const blue = [0x1f, 0x5e, 0xff] as const

// 32 × 16 images, left half BTC orange, right half blue, encoded by libvips
// (sharp): JPEG baseline and progressive (4:2:0), WebP lossy and lossless,
// and a GIF. The grey JPEG is one channel, 40 left and 200 right.
const fixtures = {
  jpegBaseline:
    "/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQACADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABUBAQEAAAAAAAAAAAAAAAAAAAgJ/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AroAZFAyOAuAnO//Z",
  jpegProgressive:
    "/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCAAQACADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAYH/8QAFQEBAQAAAAAAAAAAAAAAAAAABwj/2gAMAwEAAhADEAAAAa4DChkYuCc//8QAFBABAAAAAAAAAAAAAAAAAAAAMP/aAAgBAQABBQIP/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwE//8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwE//8QAFBABAAAAAAAAAAAAAAAAAAAAMP/aAAgBAQAGPwIP/8QAFBABAAAAAAAAAAAAAAAAAAAAMP/aAAgBAQABPyEP/9oADAMBAAIAAwAAABD77//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QP//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QP//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAT8QD//Z",
  jpegGrey:
    "/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAAQACABAREA/8QAFgABAQEAAAAAAAAAAAAAAAAAAAkI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwDCgtWIqC1Y/9k=",
  webpLossy:
    "UklGRl4AAABXRUJQVlA4IFIAAADQBACdASogABAAPjEYiUKiIaEYBAAgAwS0AE6ZQjgbwD8AP1A/wHIBdgP1VAwy4AD+97Qf/8zx/ddrdf/uecOuqen/uAiWWjm3ExCgb2pSgAAA",
  webpLossless:
    "UklGRioAAABXRUJQVlA4TB0AAAAvH8ADAA/wGq9/YH/jf/6jBQKBJH/pARaI6H8ULwA=",
  gif: "R0lGODlhIAAQAIEAAExpcR9e//eTGgAAACH5BAUAAAAALAAAAAAgABAAAAIrlI8pwe0flDywtjmtxVJXrngQmIgPiZgOSqkMa7gvLEe0DC/47ea1v2PVCgA7",
} as const

function bytesOf(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"))
}

/** RGBA of the sample cell nearest image pixel (`x`, `y`). */
function pixelAt(sample: PixelSample, x: number, y: number): number[] {
  const column = Math.min(
    sample.columns - 1,
    Math.floor((x * sample.columns) / sample.width),
  )
  const row = Math.min(
    sample.rows - 1,
    Math.floor((y * sample.rows) / sample.height),
  )
  const offset = (row * sample.columns + column) * 4
  return Array.from(sample.rgba.subarray(offset, offset + 4))
}

function expectNear(
  actual: number[],
  expected: readonly number[],
  tolerance: number,
) {
  for (const [index, value] of expected.entries()) {
    expect(Math.abs((actual[index] ?? -999) - value)).toBeLessThanOrEqual(
      tolerance,
    )
  }
}

// --- PNG writer for synthetic images ---------------------------------------

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(body, 8)
  // The decoder ignores CRCs; leave them zero.
  return out
}

type PngOptions = {
  width: number
  height: number
  depth: number
  colorType: number
  interlaced?: boolean
  palette?: number[]
  transparency?: number[]
}

function png(options: PngOptions, filteredRows: Uint8Array): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, options.width)
  view.setUint32(4, options.height)
  header[8] = options.depth
  header[9] = options.colorType
  header[12] = options.interlaced === true ? 1 : 0
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
  ]
  if (options.palette !== undefined) {
    parts.push(chunk("PLTE", Uint8Array.from(options.palette)))
  }
  if (options.transparency !== undefined) {
    parts.push(chunk("tRNS", Uint8Array.from(options.transparency)))
  }
  // Two IDAT chunks, to exercise concatenation.
  const compressed = new Uint8Array(deflateSync(filteredRows))
  const middle = Math.floor(compressed.length / 2)
  parts.push(chunk("IDAT", compressed.subarray(0, middle)))
  parts.push(chunk("IDAT", compressed.subarray(middle)))
  parts.push(chunk("IEND", new Uint8Array(0)))
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Applies PNG filter `filter` to raw rows of `rowBytes` bytes. */
function filterRows(
  raw: Uint8Array,
  rowBytes: number,
  bpp: number,
  filter: (row: number) => number,
): Uint8Array {
  const rows = raw.length / rowBytes
  const out = new Uint8Array(rows * (rowBytes + 1))
  for (let y = 0; y < rows; y += 1) {
    const type = filter(y)
    out[y * (rowBytes + 1)] = type
    for (let i = 0; i < rowBytes; i += 1) {
      const value = raw[y * rowBytes + i] ?? 0
      const left = i >= bpp ? (raw[y * rowBytes + i - bpp] ?? 0) : 0
      const up = y > 0 ? (raw[(y - 1) * rowBytes + i] ?? 0) : 0
      const upLeft =
        y > 0 && i >= bpp ? (raw[(y - 1) * rowBytes + i - bpp] ?? 0) : 0
      const predictor =
        type === 1
          ? left
          : type === 2
            ? up
            : type === 3
              ? (left + up) >> 1
              : type === 4
                ? paeth(left, up, upLeft)
                : 0
      out[y * (rowBytes + 1) + 1 + i] = (value - predictor) & 0xff
    }
  }
  return out
}

/** RGBA test image: a hue gradient across, alpha 255. */
function gradient(width: number, height: number): Uint8Array {
  const raw = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      raw[offset] = (x * 7 + y * 3) & 255
      raw[offset + 1] = (x * 3 + y * 11) & 255
      raw[offset + 2] = (x * 13 + y) & 255
      raw[offset + 3] = 255
    }
  }
  return raw
}

describe("decodeAvatar: PNG", () => {
  it("reverses all five filters exactly", async () => {
    const width = 40
    const height = 20
    const raw = gradient(width, height)
    const bytes = png(
      { width, height, depth: 8, colorType: 6 },
      filterRows(raw, width * 4, 4, (row) => row % 5),
    )
    const sample = await decodeAvatar(bytes, limits)
    expect(sample).toMatchObject({ width, height, columns: 40, rows: 20 })
    expect(Array.from(sample.rgba)).toEqual(Array.from(raw))
  })

  it("samples a large image down to at most 64 per side", async () => {
    const width = 300
    const height = 130
    const raw = gradient(width, height)
    const bytes = png(
      { width, height, depth: 8, colorType: 6 },
      filterRows(raw, width * 4, 4, () => 4),
    )
    const sample = await decodeAvatar(bytes, limits)
    expect(sample.columns).toBeLessThanOrEqual(64)
    expect(sample.rows).toBeLessThanOrEqual(64)
    // Cell (1, 1) is raster pixel (stepX, stepY).
    const stepX = Math.ceil(width / 64)
    const stepY = Math.ceil(height / 64)
    const offset = (stepY * width + stepX) * 4
    const cell = (1 * sample.columns + 1) * 4
    expect(Array.from(sample.rgba.subarray(cell, cell + 4))).toEqual(
      Array.from(raw.subarray(offset, offset + 4)),
    )
  })

  it("reads 2-bit palettes with tRNS alpha", async () => {
    // Four pixels per byte: indices 0, 1, 2, 3.
    const rows = new Uint8Array([0, 0b00_01_10_11, 0, 0b11_10_01_00])
    const bytes = png(
      {
        width: 4,
        height: 2,
        depth: 2,
        colorType: 3,
        palette: [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9],
        transparency: [255, 255, 255, 0],
      },
      rows,
    )
    const sample = await decodeAvatar(bytes, limits)
    expect(Array.from(sample.rgba.subarray(0, 16))).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0,
    ])
    expect(Array.from(sample.rgba.subarray(16, 20))).toEqual([9, 9, 9, 0])
  })

  it("reads 16-bit RGB and grey with alpha", async () => {
    const rgb = png(
      { width: 1, height: 1, depth: 16, colorType: 2 },
      new Uint8Array([0, 0xf7, 0x01, 0x93, 0x02, 0x1a, 0x03]),
    )
    expect(Array.from((await decodeAvatar(rgb, limits)).rgba)).toEqual([
      0xf7, 0x93, 0x1a, 255,
    ])
    const greyAlpha = png(
      { width: 1, height: 1, depth: 8, colorType: 4 },
      new Uint8Array([0, 120, 40]),
    )
    expect(Array.from((await decodeAvatar(greyAlpha, limits)).rgba)).toEqual([
      120, 120, 120, 40,
    ])
  })

  it("samples an interlaced image from its first Adam7 pass", async () => {
    // 16 × 16 RGB: pass 1 is 2 × 2 pixels (every eighth row and column).
    const passOne = new Uint8Array([
      0,
      ...orange,
      ...blue,
      0,
      ...blue,
      ...orange,
    ])
    const bytes = png(
      { width: 16, height: 16, depth: 8, colorType: 2, interlaced: true },
      passOne,
    )
    const sample = await decodeAvatar(bytes, limits)
    expect(sample).toMatchObject({ width: 16, height: 16, columns: 2, rows: 2 })
    expect(Array.from(sample.rgba)).toEqual([
      ...orange,
      255,
      ...blue,
      255,
      ...blue,
      255,
      ...orange,
      255,
    ])
  })

  it("refuses images over the pixel limit before inflating", async () => {
    const bytes = png(
      { width: 5000, height: 5000, depth: 8, colorType: 2 },
      new Uint8Array(10),
    )
    await expect(decodeAvatar(bytes, limits)).rejects.toMatchObject({
      reason: "too-large",
    })
  })
})

describe("decodeAvatar: JPEG, WebP and GIF", () => {
  for (const [name, tolerance] of [
    ["jpegBaseline", 12],
    ["jpegProgressive", 12],
    ["webpLossy", 12],
    ["webpLossless", 0],
    ["gif", 0],
  ] as const) {
    it(`decodes ${name}`, async () => {
      const sample = await decodeAvatar(bytesOf(fixtures[name]), limits)
      expect(sample).toMatchObject({ width: 32, height: 16 })
      expectNear(pixelAt(sample, 2, 8), [...orange, 255], tolerance)
      expectNear(pixelAt(sample, 29, 8), [...blue, 255], tolerance)
    })
  }

  it("decodes a one-channel JPEG as grey", async () => {
    const sample = await decodeAvatar(bytesOf(fixtures.jpegGrey), limits)
    expectNear(pixelAt(sample, 2, 8), [40, 40, 40, 255], 4)
    expectNear(pixelAt(sample, 29, 8), [200, 200, 200, 255], 4)
  })

  it("refuses unknown formats and truncated files", async () => {
    await expect(
      decodeAvatar(new TextEncoder().encode("<svg></svg>"), limits),
    ).rejects.toBeInstanceOf(AvatarDecodeError)
    const truncated = bytesOf(fixtures.jpegBaseline).subarray(0, 120)
    await expect(decodeAvatar(truncated, limits)).rejects.toMatchObject({
      reason: "corrupt",
    })
  })
})
