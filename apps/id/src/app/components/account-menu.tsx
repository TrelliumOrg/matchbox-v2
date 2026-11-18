import { Icon } from "@matchbox/ui/icons"
import * as Theme from "@matchbox/ui/theme"
import * as Tooltip from "@matchbox/ui/tooltip"
import { Link, useRouter } from "@tanstack/react-router"
import { DropdownMenu } from "radix-ui"
import { type ReactNode, useState } from "react"
import type { IdentityAccountView } from "../../shared/contracts"
import { PillFace } from "./account-pill"
import { Glyph, type GlyphName } from "./glyphs"

const item =
  "flex h-[52px] cursor-pointer items-center gap-3.5 rounded-[14px] px-2 text-[15.5px] font-medium text-ink outline-none data-[highlighted]:bg-soft"

function MenuIcon({ name }: { name: GlyphName }): ReactNode {
  return (
    <span className="grid size-9 place-items-center rounded-full bg-soft text-ink">
      <Glyph name={name} size={18} />
    </span>
  )
}

/**
 * The account pill's menu: theme, appearance, apps, sessions, sign out.
 * Loaded on the first intent (see account-pill.tsx), opened at once.
 */
export default function AccountMenu({
  account,
}: {
  account: IdentityAccountView
}): ReactNode {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function signOut(): Promise<void> {
    setSigningOut(true)
    try {
      const { api } = await import("../lib/api")
      await api.signOut()
    } finally {
      setSigningOut(false)
      await router.invalidate()
      await router.navigate({ to: "/sign-in", replace: true })
    }
  }

  return (
    <DropdownMenu.Root defaultOpen>
      <DropdownMenu.Trigger asChild>
        <PillFace account={account} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          className="z-50 w-[300px] rounded-[24px] bg-pop p-2 shadow-pop"
        >
          <div className="flex h-[52px] items-center gap-3.5 px-2">
            <MenuIcon name="palette" />
            <span className="flex-1 text-[15.5px] font-medium text-ink">
              Theme
            </span>
            <Tooltip.Provider>
              <Theme.QuickSwitch />
            </Tooltip.Provider>
          </div>
          <DropdownMenu.Item asChild className={item}>
            <Link to="/" search={{ tab: "appearance" }}>
              <MenuIcon name="palette" />
              Appearance
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}>
            <Link to="/" search={{}}>
              <MenuIcon name="layout-grid" />
              Connected apps
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}>
            <Link to="/" search={{ tab: "sessions" }}>
              <span className="grid size-9 place-items-center rounded-full bg-soft text-ink">
                <Icon name="monitor" size={18} strokeWidth={1.8} />
              </span>
              Sessions
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-line" />
          <DropdownMenu.Item
            className={`${item} text-neg`}
            disabled={signingOut}
            onSelect={() => void signOut()}
          >
            <span className="grid size-9 place-items-center rounded-full bg-neg-soft text-neg">
              <Glyph name="log-out" size={18} />
            </span>
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
