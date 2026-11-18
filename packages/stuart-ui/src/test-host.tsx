import type { ReactNode } from "react"
import { HostProvider, type PanelHost } from "./host"

/** Renders blocks inside a panel host for tests. */
export function withHost(
  children: ReactNode,
  overrides: Partial<PanelHost> = {},
): ReactNode {
  const host: PanelHost = {
    endpoint: null,
    wallet: {
      address: "0x7c21095156ab25e989c3c084bcb06037c6539e0b",
      mode: "connected",
    },
    signer: null,
    navigate: () => {},
    hrefFor: (to) => to,
    scanUrl: "https://scan.matchbox.markets",
    ask: () => {},
    busy: false,
    signing: { mode: "wallet" },
    ...overrides,
  }
  return <HostProvider value={host}>{children}</HostProvider>
}
