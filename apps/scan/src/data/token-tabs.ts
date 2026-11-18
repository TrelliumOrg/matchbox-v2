import { createServerFn } from "@tanstack/react-start"
import { withMezoIds } from "./scan/mezo-names.server"
import type { TokenSlug } from "./scan/token-list"
import { type DataTab, tokenTab } from "./token-tabs.server"

/**
 * The token pages' tabs (work in token-tabs.server), holders and transfers
 * named by their cached Mezo IDs (scan/mezo-names).
 */

export type {
  DataTab,
  HolderRow,
  TokenContract,
  TokenHolders,
  TokenTabData,
  TokenTransferRow,
} from "./token-tabs.server"

function identity<T>(input: T): T {
  return input
}

export const getTokenTab = createServerFn({ method: "GET" })
  .validator(
    identity<{
      slug: TokenSlug
      tab: DataTab
      cursor: Record<string, unknown>
    }>,
  )
  .handler(async ({ data }) => withMezoIds(await tokenTab(data)))
