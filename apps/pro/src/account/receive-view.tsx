import { Glyph, shapes } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as WalletDrawer from "@matchbox/ui/wallet-drawer"
import type { ReactNode } from "react"
import { share } from "./glyphs"
import { useCopy, ViewHeader } from "./panel-parts"
import { qrPath } from "./qr"

/**
 * Receive (frame `nfGe_W-agZ`): QR code, Mezo ID, the full address, Copy
 * and Share. Loaded with qrcode-generator when Receive is first wanted.
 * The code stays dark on white in both themes, which scans best.
 */
export default function ReceiveView({
  address,
  mezoId,
  onBack,
}: {
  address: string
  mezoId: string | null
  onBack: () => void
}): ReactNode {
  const { copied, copy } = useCopy()
  const qr = qrPath(address)
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function"

  return (
    <>
      <ViewHeader title="Receive" onBack={onBack} />
      <WalletDrawer.Body className="flex flex-col items-center">
        <figure className="flex flex-col items-center">
          <span className="rounded-[24px] bg-white p-5">
            <svg
              role="img"
              aria-label={`QR code for ${address}`}
              viewBox={`-1 -1 ${qr.size + 2} ${qr.size + 2}`}
              width={200}
              height={200}
              shapeRendering="crispEdges"
              className="block"
            >
              <path d={qr.d} className="fill-black" />
            </svg>
          </span>
          <figcaption className="mt-6 flex flex-col items-center gap-1.5 text-center">
            {mezoId === null ? null : (
              <span className="text-[19px] font-[650]">{mezoId}</span>
            )}
            <span className="font-mono text-[13.5px] break-all text-ink">
              {address}
            </span>
          </figcaption>
        </figure>
        <ul className="mt-6 flex w-full gap-3">
          <li className="flex-1">
            <PillButton.Root
              intent="neutral"
              className="w-full bg-soft dark:bg-soft2"
              onClick={() => copy("address", address)}
            >
              <Glyph
                shape={copied === "address" ? shapes.check : shapes.copy}
                size={18}
                strokeWidth={1.9}
                className={copied === "address" ? "mbx-draw" : undefined}
              />
              {copied === "address" ? "Copied" : "Copy"}
            </PillButton.Root>
          </li>
          {canShare ? (
            <li className="flex-1">
              <PillButton.Root
                intent="neutral"
                className="w-full bg-soft dark:bg-soft2"
                onClick={() =>
                  void navigator
                    .share({ title: mezoId ?? "Mezo address", text: address })
                    .catch(() => undefined)
                }
              >
                <Glyph shape={share} size={18} strokeWidth={1.9} />
                Share
              </PillButton.Root>
            </li>
          ) : null}
        </ul>
      </WalletDrawer.Body>
      <WalletDrawer.Footer className="text-center">
        Mezo mainnet only
      </WalletDrawer.Footer>
    </>
  )
}
