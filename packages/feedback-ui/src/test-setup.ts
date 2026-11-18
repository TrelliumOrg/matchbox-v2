import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"
import { resetSession } from "./store"

afterEach(() => {
  cleanup()
  resetSession()
})
