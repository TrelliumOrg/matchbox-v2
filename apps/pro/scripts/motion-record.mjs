// Records Pro's motion against a running preview: for each transition it
// samples the moving element every frame (opacity, transform, presence),
// records a video per run and cuts frames at 20, 50 and 80% of each
// transition from it (with ffmpeg on the PATH). Runs at
// 1440 and 390, light and dark, and 1440 with reduced motion; writes
// report.json and fails when a transition that should move does not, or
// moves under reduced motion. apps/pro/MOTION.md lists what each checks.
// Usage: node scripts/motion-record.mjs <outDir> [baseUrl]
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const out = process.argv[2] ?? "motion"
const base = process.argv[3] ?? "http://localhost:4173"
const user = "/0x7c21095156ab25e989c3c084bcb06037c6539e0b"

const runs = [
  { name: "1440-light", width: 1440, height: 900, scheme: "light" },
  { name: "1440-dark", width: 1440, height: 900, scheme: "dark" },
  { name: "390-light", width: 390, height: 844, scheme: "light", phone: true },
  { name: "390-dark", width: 390, height: 844, scheme: "dark", phone: true },
  {
    name: "1440-reduced",
    width: 1440,
    height: 900,
    scheme: "light",
    reduced: true,
  },
]

/**
 * Samples `selector` every animation frame for `ms`: whether it is there,
 * its opacity and its transform (the computed matrix), plus the first
 * animated property seen. Taken inside the page so frames are not missed.
 */
function sample(page, selector, ms) {
  return page.evaluate(
    ([selector, ms]) =>
      new Promise((resolve) => {
        const frames = []
        const start = performance.now()
        function read(element) {
          const style = getComputedStyle(element)
          const matrix =
            style.transform === "none"
              ? null
              : new DOMMatrixReadOnly(style.transform)
          return {
            opacity: Number(style.opacity),
            x: matrix === null ? 0 : Math.round(matrix.m41),
            y: matrix === null ? 0 : Math.round(matrix.m42),
            sx: matrix === null ? 1 : +matrix.a.toFixed(3),
            sy: matrix === null ? 1 : +matrix.d.toFixed(3),
            dash: Number.parseFloat(style.strokeDashoffset) || 0,
            running: element
              .getAnimations({ subtree: true })
              .some((animation) => animation.playState === "running"),
          }
        }
        function tick() {
          const t = Math.round(performance.now() - start)
          const element = document.querySelector(selector)
          frames.push(
            element === null ? { t, gone: true } : { t, ...read(element) },
          )
          if (performance.now() - start < ms) requestAnimationFrame(tick)
          else resolve(frames)
        }
        tick()
      }),
    [selector, ms],
  )
}

/**
 * What the frames show: whether the element changed between frames (moved,
 * scaled, faded or drew), from when to when, and when it left.
 */
function summarise(frames) {
  const key = (frame) =>
    frame.gone
      ? "gone"
      : `${frame.opacity.toFixed(2)} ${frame.x} ${frame.y} ${frame.sx} ${frame.sy} ${frame.dash.toFixed(3)}`
  const changes = []
  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1]
    const now = frames[index]
    if (before.gone || now.gone) continue
    if (key(before) !== key(now)) changes.push(now.t)
  }
  return {
    animated: changes.length > 1,
    movingMs:
      changes.length === 0 ? 0 : changes[changes.length - 1] - changes[0],
    startMs: changes[0] ?? null,
    present: frames.some((frame) => !frame.gone),
    goneAt:
      frames.findIndex((frame) => !frame.gone) === -1
        ? null
        : (frames.find(
            (frame, index) =>
              frame.gone && frames.slice(0, index).some((seen) => !seen.gone),
          )?.t ?? null),
  }
}

/** Transitions to cut frames for, per run: where in the video and when. */
let marks = []

/**
 * Runs `act` while sampling `selector`, and marks the transition so its
 * frames can be cut from the run's video afterwards (screenshots taken
 * during it would land late and slow it down).
 */
async function record(page, dir, label, selector, ms, act) {
  const wall = Date.now()
  const sampling = sample(page, selector, ms).catch(() => [])
  await act()
  const result = summarise(await sampling)
  marks.push({ dir, label, wall, result })
  return result
}

/** Frames at 20, 50 and 80% of each transition, from the run's video. */
function cutFrames(video, videoStart) {
  for (const { dir, label, wall, result } of marks) {
    if (!result.animated || result.startMs === null) continue
    for (const share of [0.2, 0.5, 0.8]) {
      const at = wall - videoStart + result.startMs + result.movingMs * share
      const cut = spawnSync(
        "ffmpeg",
        [
          "-loglevel",
          "error",
          "-y",
          "-ss",
          (at / 1000).toFixed(3),
          "-i",
          video,
          "-frames:v",
          "1",
          "-q:v",
          "4",
          `${dir}/${label}-${Math.round(share * 100)}.jpg`,
        ],
        { stdio: "ignore" },
      )
      if (cut.error !== undefined) {
        console.log("ffmpeg not found: videos kept, no frames cut")
        return
      }
    }
  }
}

async function settle(page, path) {
  await page.goto(base + path, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)
}

/** Each scenario returns `{ name: summary }` entries and whether it should move. */
const scenarios = [
  {
    name: "activity-sheet",
    async run(page, dir) {
      await settle(page, `${user}/activity`)
      const row = page.locator("main li button").first()
      const open = await record(
        page,
        dir,
        "activity-sheet-open",
        '[role="dialog"]',
        600,
        () => row.click(),
      )
      await page.waitForTimeout(300)
      const close = await record(
        page,
        dir,
        "activity-sheet-close",
        '[role="dialog"]',
        600,
        () => page.keyboard.press("Escape"),
      )
      return { open, close }
    },
  },
  {
    name: "account-panel",
    async run(page, dir) {
      await settle(page, user)
      const button = page.getByRole("button", { name: /^Account/ })
      await button.hover()
      await page.waitForTimeout(400)
      const open = await record(
        page,
        dir,
        "account-open",
        '[role="dialog"]',
        600,
        () => button.click(),
      )
      await page.waitForTimeout(300)
      const push = await record(
        page,
        dir,
        "account-network",
        '[role="dialog"] [data-mbx-motion].flex-1',
        500,
        () => page.getByRole("button", { name: /^Network/ }).click(),
      )
      await page.waitForTimeout(300)
      // Escape on a sub-view goes back to the main view first.
      const back = await record(
        page,
        dir,
        "account-back",
        '[role="dialog"] [data-mbx-motion].flex-1',
        500,
        () => page.keyboard.press("Escape"),
      )
      await page.waitForTimeout(300)
      const close = await record(
        page,
        dir,
        "account-close",
        '[role="dialog"]',
        600,
        () => page.keyboard.press("Escape"),
      )
      return { open, push, back, close }
    },
  },
  {
    name: "stuart",
    async run(page, dir, run) {
      await settle(page, user)
      await page.waitForTimeout(2200)
      const panel = run.phone ? ".stuart-search-phone" : ".stuart-panel"
      const open = await record(
        page,
        dir,
        "stuart-open",
        panel,
        700,
        async () => {
          if (run.phone) {
            await page
              .getByRole("button", { name: "Ask Stuart or search" })
              .click()
          } else {
            await page.keyboard.press("Control+k")
            await page.keyboard.type("What is my best gauge")
            await page.keyboard.press("Enter")
          }
        },
      )
      await page.waitForTimeout(500)
      const close = await record(page, dir, "stuart-close", panel, 600, () =>
        page.keyboard.press("Escape"),
      )
      return { open, close }
    },
  },
  {
    name: "count-up",
    async run(page, dir) {
      await page.evaluate(() => sessionStorage.clear())
      await page.goto(`${base}/protocol`, { waitUntil: "networkidle" })
      await page.evaluate(() => window.scrollTo(0, 0))
      const result = await record(
        page,
        dir,
        "count-up",
        "[data-count-up] number-flow",
        3500,
        () =>
          page
            .getByRole("link", { name: /Kiln Labs|Sats Collective|veBTC/ })
            .first()
            .click(),
      )
      // The digits roll inside NumberFlow's shadow root: the overlay that
      // carries them appearing, then leaving, is the count-up.
      return {
        figures: {
          ...result,
          animated: result.present && result.goneAt !== null,
          movingMs: result.goneAt ?? 0,
        },
      }
    },
  },
  {
    name: "chart",
    async run(page, dir, run) {
      // Phones have no Protocol tab: load it, the chart is below the fold.
      await page.goto(`${base}${run.phone ? "/protocol" : user}`, {
        waitUntil: "networkidle",
      })
      const draw = await record(
        page,
        dir,
        "chart-draw",
        "[data-chart] button:last-child [data-bar]",
        2500,
        async () => {
          if (!run.phone) {
            await page.getByRole("link", { name: "Protocol" }).first().click()
          }
          await page.locator("[data-chart]").first().scrollIntoViewIfNeeded()
        },
      )
      await page.waitForTimeout(500)
      const morph = await record(
        page,
        dir,
        "chart-series",
        "[data-chart] button:nth-last-child(3) [data-bar]",
        700,
        () => page.getByRole("radio", { name: "Validators" }).click(),
      )
      const segment = await record(
        page,
        dir,
        "segmented-pill",
        '[role="radiogroup"] > span[aria-hidden]',
        500,
        () => page.getByRole("radio", { name: "Pools" }).click(),
      )
      return { draw, morph, segment }
    },
  },
  {
    name: "vote-lists",
    async run(page, dir, run) {
      await settle(page, `${user}/vote`)
      const type = await record(
        page,
        dir,
        "type-indicator",
        run.phone
          ? 'nav[aria-label="Gauge types"] > ul [aria-current="page"] > span[aria-hidden]'
          : 'nav[aria-label="Gauge types"] div [aria-current="page"] > span[aria-hidden]',
        600,
        () =>
          page
            .getByRole("link", { name: /MEZO gauges/ })
            .filter({ visible: true })
            .first()
            .click(),
      )
      await page.waitForTimeout(500)
      await page.goto(`${base}${user}/vote/vebtc`, { waitUntil: "networkidle" })
      await page.waitForTimeout(800)
      const reorder = await record(
        page,
        dir,
        "grid-reorder",
        "main ul.grid[data-flip-list] > li:nth-child(2)",
        700,
        () => page.locator("main select").selectOption("apy"),
      )
      const filter = await record(
        page,
        dir,
        "grid-filter",
        "main ul.grid[data-flip-list] > [data-ghost]",
        700,
        () => page.getByRole("button", { name: /^Funded/ }).click(),
      )
      const pick = await record(
        page,
        dir,
        "gauge-pick",
        "main ul.grid[data-flip-list] > li:nth-child(3) button[aria-pressed] > span[aria-hidden]",
        500,
        () =>
          page
            .locator(
              "main ul.grid[data-flip-list] > li:nth-child(3) button[aria-pressed]",
            )
            .click(),
      )
      return { type, reorder, filter, pick }
    },
  },
  {
    name: "popover",
    async run(page, dir, run) {
      await settle(page, `${user}/activity`)
      const trigger = page.locator("main button[aria-expanded]").first()
      const bubble = "main [data-mbx-pop]"
      const open = await record(page, dir, "popover-open", bubble, 400, () =>
        run.phone ? trigger.tap() : trigger.hover(),
      )
      await page.waitForTimeout(300)
      const close = await record(page, dir, "popover-close", bubble, 400, () =>
        page.keyboard.press("Escape"),
      )
      return { open, close }
    },
  },
  {
    name: "sidebar",
    desktop: true,
    async run(page, dir) {
      await settle(page, user)
      const nav = await record(
        page,
        dir,
        "sidebar-pill",
        'aside [aria-current="page"] > span[aria-hidden]',
        700,
        () => page.getByRole("link", { name: "Protocol" }).first().click(),
      )
      return { nav }
    },
  },
]

mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const report = {}
let failed = false
for (const run of runs) {
  const dir = `${out}/${run.name}`
  mkdirSync(dir, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: run.width, height: run.height },
    colorScheme: run.scheme,
    reducedMotion: run.reduced ? "reduce" : "no-preference",
    isMobile: run.phone === true,
    hasTouch: run.phone === true,
    recordVideo: { dir, size: { width: run.width, height: run.height } },
  })
  const page = await context.newPage()
  const videoStart = Date.now()
  marks = []
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  report[run.name] = {}
  for (const scenario of scenarios) {
    if (scenario.desktop && run.phone) continue
    try {
      const result = await scenario.run(page, dir, run)
      report[run.name][scenario.name] = result
      for (const [step, summary] of Object.entries(result)) {
        const bad = run.reduced ? summary.movingMs > 160 : !summary.animated
        if (bad) failed = true
        console.log(
          `${run.name.padEnd(13)} ${`${scenario.name}.${step}`.padEnd(28)} ${summary.animated ? "moves" : "still"} ${String(summary.movingMs).padStart(4)}ms${summary.goneAt === null ? "" : `, gone at ${summary.goneAt}ms`}${bad ? "  FAIL" : ""}`,
        )
      }
    } catch (error) {
      failed = true
      report[run.name][scenario.name] = { error: String(error) }
      console.log(
        `${run.name} ${scenario.name}: ${String(error).split("\n")[0]}`,
      )
    }
  }
  if (errors.length > 0) {
    failed = true
    console.log(`${run.name} page errors: ${errors.join(" | ")}`)
  }
  await context.close()
  const video = await page.video()?.path()
  if (video !== undefined) cutFrames(video, videoStart)
}
await browser.close()
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
if (failed) process.exitCode = 1
