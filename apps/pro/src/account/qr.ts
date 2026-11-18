import qrcode from "qrcode-generator"

/**
 * A QR code as one SVG path (one square per dark module), drawn in the
 * page's ink so it follows the theme. qrcode-generator (MIT) is imported
 * only by the Receive view, which loads on demand.
 */

export type QrPath = { size: number; d: string }

export function qrPath(text: string): QrPath {
  const code = qrcode(0, "M")
  code.addData(text, "Byte")
  code.make()
  const size = code.getModuleCount()
  const parts: string[] = []
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (code.isDark(row, col)) parts.push(`M${col} ${row}h1v1h-1z`)
    }
  }
  return { size, d: parts.join("") }
}
