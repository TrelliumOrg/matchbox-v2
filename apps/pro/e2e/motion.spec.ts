import { expect, type Page, test } from "@playwright/test"

/**
 * Exits mirror entries (ledger M1, M6, L6): a sheet or drawer that closes
 * stays mounted while it slides out, takes no clicks while it goes, and
 * unmounts after its exit; under reduced motion it goes at once.
 */

const user = "/pyke.mezo"

type Exit = {
  /** Pointer events in the first frame of the exit, or "removed". */
  pointerEvents: string
  /** The exit animation's declared length in that frame, 0 with none. */
  declaredMs: number
  /** From the action to the exit animation's end, or null if none ended. */
  ranMs: number | null
  /** From the action (or the animation's end, if one ran) to the removal. */
  lingerMs: number
}

declare global {
  interface Window {
    exitWatch?: Promise<Exit>
  }
}

/**
 * Watches the open dialog from inside the page, from the next keydown or
 * click until it is removed: whether it took pointer events in the first
 * frame of its exit, how long an exit it declared, when that animation
 * ended and how long the dialog stayed after it. Nothing here is compared
 * with a fixed time: a loaded runner stretches every span alike, so the
 * tests compare the spans with each other and with the declared length.
 * Read it with `exitOf(page)` after the action.
 */
async function watchExit(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) throw new Error("no dialog open")
    window.exitWatch = new Promise<Exit>((resolve) => {
      let start = 0
      let ended: number | null = null
      let pointerEvents = ""
      let declaredMs = 0
      function begin(): void {
        start = performance.now()
        requestAnimationFrame(() => {
          if (!dialog?.isConnected) {
            pointerEvents = "removed"
            return
          }
          pointerEvents = getComputedStyle(dialog).pointerEvents
          for (const animation of dialog.getAnimations()) {
            const length = animation.effect?.getComputedTiming().endTime
            if (typeof length === "number" && length > declaredMs) {
              declaredMs = length
            }
          }
        })
      }
      window.addEventListener("keydown", begin, { once: true, capture: true })
      window.addEventListener("pointerdown", begin, {
        once: true,
        capture: true,
      })
      // Capture on the document, so this runs before the dialog's own
      // listener unmounts it.
      document.addEventListener(
        "animationend",
        (event) => {
          if (event.target === dialog && start > 0) ended = performance.now()
        },
        { capture: true },
      )
      new MutationObserver((_records, observer) => {
        if (dialog.isConnected) return
        observer.disconnect()
        const removed = performance.now()
        resolve({
          // Still unset: it left before the first frame was drawn.
          pointerEvents: pointerEvents === "" ? "removed" : pointerEvents,
          declaredMs,
          ranMs: ended === null ? null : ended - start,
          lingerMs: removed - (ended ?? start),
        })
      }).observe(document.body, { childList: true, subtree: true })
    })
  })
}

/**
 * A dialog that slid out: inert from the first frame, mounted until the
 * exit it declared had played, and removed as that exit ended instead of
 * waiting on something else.
 */
function expectSlidOut(exit: Exit): void {
  expect(exit.pointerEvents).toBe("none")
  expect(exit.declaredMs).toBeGreaterThan(200)
  expect(exit.ranMs).not.toBeNull()
  // The animation runs on the page's clock, so it cannot end early.
  expect(exit.ranMs ?? 0).toBeGreaterThan(200)
  expect(exit.lingerMs).toBeLessThan(exit.ranMs ?? 0)
}

function exitOf(page: Page): Promise<Exit> {
  return page.evaluate(() => {
    if (window.exitWatch === undefined) throw new Error("not watching")
    return window.exitWatch
  })
}

async function openAccount(page: Page): Promise<void> {
  await page.goto(user)
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: /^Account/ }).click()
  const panel = page.getByRole("dialog")
  await expect(panel).toHaveAttribute("data-state", "open")
  // Let the slide in finish.
  await page.waitForTimeout(450)
}

test.describe("exits", () => {
  test.skip(({ isMobile }) => isMobile, "one viewport is enough")

  test("the Account panel slides out, then unmounts", async ({ page }) => {
    await openAccount(page)
    await watchExit(page)
    await page.keyboard.press("Escape")
    // Inert while it goes, gone once its exit has played.
    expectSlidOut(await exitOf(page))
  })

  test("clicks go through while the Account panel slides out", async ({
    page,
  }) => {
    await openAccount(page)
    await page.keyboard.press("Escape")
    // Straight away, mid exit: the nav must answer.
    await page.getByRole("link", { name: "Protocol" }).first().click()
    await expect(page).toHaveURL(/\/protocol$/)
  })

  test("an Activity sheet slides out, then unmounts", async ({ page }) => {
    await page.goto(`${user}/activity`)
    await page.waitForLoadState("networkidle")
    await page.locator("main li button").first().click()
    const sheet = page.getByRole("dialog")
    await expect(sheet).toHaveAttribute("data-state", "open")
    await page.waitForTimeout(450)
    await watchExit(page)
    await sheet.getByRole("button", { name: "Close" }).click()
    expectSlidOut(await exitOf(page))
  })

  test("a popover fades out instead of vanishing", async ({ page }) => {
    await page.goto(`${user}/activity`)
    await page.waitForLoadState("networkidle")
    const trigger = page.locator("main button[aria-expanded]").first()
    await trigger.hover()
    const open = page.locator("[data-mbx-pop]:popover-open")
    await expect(open).toBeVisible()
    await page.mouse.move(5, 5)
    await page.mouse.down()
    await page.mouse.up()
    // Hidden from the top layer but still in the page for its fade.
    await expect(open).toHaveCount(0)
    await expect(page.locator("main [data-mbx-pop]").first()).toBeAttached()
  })

  test("under reduced motion the Account panel goes at once", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openAccount(page)
    await watchExit(page)
    await page.keyboard.press("Escape")
    // No exit plays: it is out of the page before the next frame is drawn.
    const exit = await exitOf(page)
    expect(exit.pointerEvents).toBe("removed")
    expect(exit.declaredMs).toBe(0)
    expect(exit.ranMs).toBeNull()
  })
})
