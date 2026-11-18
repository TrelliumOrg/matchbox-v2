import type { ReactElement } from "react"

export function clock(): ReactElement {
  return (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  )
}
