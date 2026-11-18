import { closeStuartSearch } from "@matchbox/stuart-ui/launcher"
import { SearchSheet } from "@matchbox/stuart-ui/search"
import { askStuart } from "@matchbox/stuart-ui/store"
import { useRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { useLockCommands } from "./lock-commands"
import { stuartEndpoint, stuartNavigate } from "./navigate"

/** Phones: the search sheet the top bar's search icon opens. Loaded then. */
export default function SearchSheetLoader({
  open,
}: {
  open: boolean
}): ReactNode {
  const router = useRouter()
  useLockCommands()
  return (
    <SearchSheet
      endpoint={stuartEndpoint()}
      open={open}
      onAsk={(question) => askStuart(question, undefined, "palette")}
      onNavigate={(to) => stuartNavigate(router, to)}
      onClose={closeStuartSearch}
    />
  )
}
