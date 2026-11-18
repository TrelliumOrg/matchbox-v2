// Screenshots of every route for visual review against the Doop frames.
// Usage: node scripts/shots.mjs <outDir> [baseUrl]
import { chromium } from "@playwright/test"

const out = process.argv[2] ?? "shots"
const base = process.argv[3] ?? "http://localhost:4173"
const user = "address=0x7c21095156ab25e989c3c084bcb06037c6539e0b"
const empty = "address=0x3f90c2d4e6f8a0b1c3d5e7f9a1b3c5d7e9f0a17c"
const pages = [
  ["overview-signed-out", "/"],
  ["overview", `/?${user}`],
  ["overview-no-locks", `/?${empty}`],
  ["vote", `/vote?${user}`],
  ["vote-no-lock", `/vote?${empty}`],
  ["rewards", `/rewards?${user}`],
  ["rewards-none", `/rewards?${empty}`],
  ["activity", `/activity?${user}`],
  ["activity-none", `/activity?${empty}`],
  ["protocol", "/protocol"],
  ["gauge", `/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159?${user}`],
]
const widths = (process.env.WIDTHS ?? "1440").split(",").map(Number)
const scheme = process.env.SCHEME === "dark" ? "dark" : "light"
const browser = await chromium.launch()
for (const width of widths) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: scheme,
  })
  const page = await context.newPage()
  const errors = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(String(error)))
  for (const [name, path] of pages) {
    if (process.env.ONLY && !process.env.ONLY.split(",").includes(name))
      continue
    errors.length = 0
    await page.goto(base + path, { waitUntil: "networkidle" })
    await page.waitForTimeout(400)
    await page.screenshot({
      path: `${out}/${name}-${width}-${scheme}.png`,
      fullPage: true,
    })
    console.log(
      `${name} ${width}: ${errors.length === 0 ? "ok" : errors.join(" | ")}`,
    )
  }
  await context.close()
}
await browser.close()
