// Decoders return a small grid of RGBA samples, not the whole image: picking
// a colour needs area, not detail, and a 64 × 64 grid keeps the picker cheap
// whatever the source size.

/** Most samples a decoder keeps per side. */
export const maxSampleSide = 64

export type PixelSample = {
  /** Source image size in pixels. */
  width: number
  height: number
  /** Sample grid size. */
  columns: number
  rows: number
  /** RGBA, `columns * rows * 4` bytes; untouched cells stay transparent. */
  rgba: Uint8Array
}

/** What the decoders refuse to work on. */
export type DecodeLimits = {
  /** Width times height. */
  maxPixels: number
}

export type DecodeFailure = "unsupported" | "too-large" | "corrupt"

export class AvatarDecodeError extends Error {
  readonly reason: DecodeFailure

  constructor(reason: DecodeFailure, message: string) {
    super(message)
    this.name = "AvatarDecodeError"
    this.reason = reason
  }
}

/** Throws unless `width × height` is a real image within `limits`. */
export function checkSize(
  width: number,
  height: number,
  limits: DecodeLimits,
): void {
  if (!(width >= 1 && height >= 1)) {
    throw new AvatarDecodeError("corrupt", `Bad image size ${width}x${height}`)
  }
  if (width * height > limits.maxPixels) {
    throw new AvatarDecodeError(
      "too-large",
      `Image ${width}x${height} is over ${limits.maxPixels} pixels`,
    )
  }
}

/** Keeps every `step`-th pixel of a `width × height` raster. */
export class SampleGrid {
  readonly stepX: number
  readonly stepY: number
  readonly columns: number
  readonly rows: number
  readonly rgba: Uint8Array

  constructor(width: number, height: number, side: number = maxSampleSide) {
    this.stepX = Math.ceil(width / side)
    this.stepY = Math.ceil(height / side)
    this.columns = Math.ceil(width / this.stepX)
    this.rows = Math.ceil(height / this.stepY)
    this.rgba = new Uint8Array(this.columns * this.rows * 4)
  }

  /** True when raster row `y` has samples. */
  wantsRow(y: number): boolean {
    return y % this.stepY === 0
  }

  /** Stores raster pixel (`x`, `y`); both must be multiples of the steps. */
  set(x: number, y: number, r: number, g: number, b: number, a: number) {
    const offset = ((y / this.stepY) * this.columns + x / this.stepX) * 4
    this.rgba[offset] = r
    this.rgba[offset + 1] = g
    this.rgba[offset + 2] = b
    this.rgba[offset + 3] = a
  }

  sample(width: number, height: number): PixelSample {
    return {
      width,
      height,
      columns: this.columns,
      rows: this.rows,
      rgba: this.rgba,
    }
  }
}

/** Clamps to a byte. */
export function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
}
