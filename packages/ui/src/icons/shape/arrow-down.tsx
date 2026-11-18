import type { ReactElement } from "react"

export function arrowDown(): ReactElement {
  return (
    <>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </>
  )
}
