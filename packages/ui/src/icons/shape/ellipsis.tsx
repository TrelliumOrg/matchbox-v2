import type { ReactElement } from "react"

export function ellipsis(): ReactElement {
  return (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  )
}
