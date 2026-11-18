import { lazy, type ReactNode, Suspense, useState } from "react"

/**
 * The only wallet code a route imports. wagmi, viem and the connectors live
 * behind this dynamic import and load on first intent (hover, focus or tap).
 */
function loadDrawer() {
  return import("./wallet-drawer")
}

const WalletDrawer = lazy(loadDrawer)

export function ConnectButton(): ReactNode {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="pill primary"
        onPointerEnter={loadDrawer}
        onFocus={loadDrawer}
        onTouchStart={loadDrawer}
        onClick={() => setOpen(true)}
      >
        Connect
      </button>
      {open ? (
        <Suspense fallback={null}>
          <WalletDrawer onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
