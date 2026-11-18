import { StuartPanel, type StuartPanelProps } from "@matchbox/stuart-ui/panel"
import { registerStuartSigner } from "@matchbox/stuart-ui/store"
import { useRouter, useRouterState, useSearch } from "@tanstack/react-router"
import { type ReactNode, useCallback, useEffect, useMemo } from "react"
import { useViewer } from "../lib/viewer"
import { useLive } from "../live/live-context"
import { useSettings } from "../settings/settings-store"
import { stuartEndpoint, stuartNavigate } from "./navigate"

/**
 * Loaded with the panel on first intent. Supplies what the panel needs from
 * Pro: the viewer (connected, watching or none), the route as page context,
 * client navigation for entity links, the Worker endpoint and the signer
 * (Pro's own review, simulate, wallet and toast steps; wagmi loads on the
 * first signature) and the Signing setting (Multisig leads with "Export
 * for Safe"). Without VITE_STUART_URL the panel plays the Epoch 47
 * fixtures.
 */

export default function PanelHost(): ReactNode {
  const router = useRouter()
  const route = useRouterState({ select: (state) => state.location.pathname })
  const search = useSearch({ from: "__root__" })
  const viewer = useViewer()
  const { store } = useLive()

  useEffect(
    () =>
      registerStuartSigner(async (request) =>
        (await import("./pro-signer")).signWithPro(request, store),
      ),
    [store],
  )

  const wallet = useMemo((): StuartPanelProps["wallet"] => {
    if (viewer.kind === "signed-out") return null
    return {
      address: viewer.address,
      mode: viewer.kind === "connected" ? "connected" : "watching",
    }
  }, [viewer])

  const navigate = useCallback(
    (to: string) => stuartNavigate(router, to),
    [router],
  )
  const settings = useSettings()
  const signing = useMemo((): NonNullable<StuartPanelProps["signing"]> => {
    const value = settings.signing
    return value.mode === "multisig"
      ? { mode: "multisig", safe: value.safe }
      : { mode: "wallet" }
  }, [settings.signing])

  const address = search.address
  const hrefFor = useCallback(
    (to: string) =>
      address === undefined
        ? to
        : `${to}?address=${encodeURIComponent(address)}`,
    [address],
  )

  return (
    <StuartPanel
      endpoint={stuartEndpoint()}
      wallet={wallet}
      route={route}
      navigate={navigate}
      hrefFor={hrefFor}
      signing={signing}
    />
  )
}
