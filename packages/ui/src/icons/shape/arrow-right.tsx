import type { ReactElement } from "react"

export function arrowRight(): ReactElement {
  return (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  )
}
