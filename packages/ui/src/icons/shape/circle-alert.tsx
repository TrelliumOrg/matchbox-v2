import type { ReactElement } from "react"

export function circleAlert(): ReactElement {
  return (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  )
}
