import type { ReactNode } from "react"
import { CalcMount } from "../boost/calc-mount"
import { ClassicNoteMount } from "../classic-note/note-mount"
import { island } from "../components/island"
import { StuartMount } from "../stuart/stuart-mount"
import { WelcomeMount } from "../welcome/welcome-mount"
import { TabBar } from "./tab-bar"
import { TopBar } from "./top-bar"

// Hidden on phones, so phones never load it (nor the block ticker at its
// foot: phones show the block in the price popover).
const Sidebar = island(
  "sidebar",
  () => import("./sidebar").then((module) => module.Sidebar),
  "sticky top-0 hidden h-dvh flex-none md:block",
)

/**
 * The root route's head holds `<link rel="expect" href="#shell-end"
 * blocking="render">`: Chromium paints nothing until the parser reaches this
 * marker. Without it a slow device can paint streamed HTML halfway through
 * the top bar or a row, and the rest arriving moves what it painted (the
 * price slot jumped 52px when the account avatar landed): CLS above 0.
 */
export const shellEndId = "shell-end"

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="min-w-0 flex-1 px-5 pt-4 pb-[calc(7rem+env(safe-area-inset-bottom))] md:px-10 md:pt-10 md:pb-[104px] lg:px-12 xl:px-[60px]">
        {/* Fluid: the header spans the width; pages that are not wide keep 1040px.
            The bottom padding clears Stuart's Ctrl K bar (54px, 24px up),
            and on phones the tab bar with the system's bottom inset. */}
        <div className="[&>main:not(:has(>[data-wide]))]:max-w-[1040px]">
          <TopBar />
          <main id="main">{children}</main>
        </div>
      </div>
      <TabBar />
      <ClassicNoteMount />
      <CalcMount />
      <StuartMount />
      <WelcomeMount />
      <span id={shellEndId} hidden />
    </div>
  )
}
