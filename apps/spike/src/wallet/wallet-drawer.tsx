import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { defineChain } from "viem"
import {
  createConfig,
  http,
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  WagmiProvider,
} from "wagmi"
import { injected } from "wagmi/connectors"

const mezo = defineChain({
  id: 31612,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-http.mezo.boar.network"] } },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.mezo.org" },
  },
})

const config = createConfig({
  chains: [mezo],
  connectors: [injected()],
  transports: { [mezo.id]: http() },
  ssr: true,
})

const queryClient = new QueryClient()

type WalletDrawerProps = {
  onClose: () => void
}

export default function WalletDrawer({
  onClose,
}: WalletDrawerProps): ReactNode {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <aside className="drawer" aria-label="Connect a wallet">
          <header className="drawer-head">
            <h2>Connect</h2>
            <button type="button" className="close" onClick={onClose}>
              Close
            </button>
          </header>
          <Connectors />
        </aside>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

function Connectors(): ReactNode {
  const account = useAccount()
  const connectors = useConnectors()
  const { mutate: connect, status } = useConnect()
  const { mutate: disconnect } = useDisconnect()

  if (account.status === "connected") {
    return (
      <p>
        {account.address.slice(0, 6)}…{account.address.slice(-4)}{" "}
        <button type="button" onClick={() => disconnect()}>
          Disconnect
        </button>
      </p>
    )
  }

  return (
    <ul className="connectors">
      {connectors.map((connector) => (
        <li key={connector.uid}>
          <button
            type="button"
            disabled={status === "pending"}
            onClick={() => connect({ connector })}
          >
            {connector.name}
          </button>
        </li>
      ))}
    </ul>
  )
}
