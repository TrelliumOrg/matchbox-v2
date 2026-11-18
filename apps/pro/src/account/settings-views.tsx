import * as PillButton from "@matchbox/ui/pill-button"
import * as WalletDrawer from "@matchbox/ui/wallet-drawer"
import { type ReactNode, useState } from "react"
import { setSettings, useSettings } from "../settings/settings-store"
import { Choice, TextBox, textActionClass, ViewHeader } from "./panel-parts"
import { rpcTestLabel, testRpc } from "./rpc-test"
import {
  type NetworkDraft,
  networkDraftFrom,
  networkToSave,
  type RpcTestRun,
  type SigningDraft,
  signingDraftFrom,
  signingToSave,
} from "./settings-drafts"

/** Network and Signing (frame `nfGe_W-agZ`), saved to this browser only. */

export function NetworkView({ onBack }: { onBack: () => void }): ReactNode {
  const settings = useSettings()
  const [draft, setDraft] = useState<NetworkDraft>(() =>
    networkDraftFrom(settings.network),
  )
  const [test, setTest] = useState<RpcTestRun | null>(null)
  const [testing, setTesting] = useState(false)
  const saving = networkToSave(draft, test)
  const url = draft.rpcUrl.trim()
  const current = test !== null && test.url === url ? test.result : null

  async function runTest(): Promise<void> {
    setTesting(true)
    const result = await testRpc(url)
    setTest({ url, result })
    setTesting(false)
  }

  return (
    <>
      <ViewHeader title="Network" onBack={onBack} />
      <WalletDrawer.Body>
        <fieldset>
          <legend className="sr-only">Reads and simulations</legend>
          <ol className="flex flex-col gap-3">
            <li>
              <Choice
                name="network"
                value="matchbox"
                checked={draft.mode === "matchbox"}
                onSelect={() => setDraft({ ...draft, mode: "matchbox" })}
                title="Matchbox"
                detail="Reads through Matchbox, writes through your wallet"
              />
            </li>
            <li>
              <Choice
                name="network"
                value="custom"
                checked={draft.mode === "custom"}
                onSelect={() => setDraft({ ...draft, mode: "custom" })}
                title="Custom RPC"
                detail="Every read and simulation uses this endpoint"
              />
            </li>
            {draft.mode === "custom" ? (
              <li>
                <TextBox
                  id="account-rpc-url"
                  label="RPC URL"
                  value={draft.rpcUrl}
                  onValueChange={(rpcUrl) => setDraft({ ...draft, rpcUrl })}
                  placeholder="https://"
                  action={
                    <button
                      type="button"
                      disabled={testing || url === ""}
                      onClick={() => void runTest()}
                      className={textActionClass}
                    >
                      {testing ? "Testing" : "Test"}
                    </button>
                  }
                  status={
                    current === null
                      ? null
                      : {
                          tone: current.kind === "ok" ? "positive" : "negative",
                          text: rpcTestLabel(current),
                        }
                  }
                />
              </li>
            ) : null}
          </ol>
        </fieldset>
      </WalletDrawer.Body>
      <WalletDrawer.Footer className="flex flex-col items-center gap-4">
        <PillButton.Root
          size="lg"
          disabled={saving === null}
          onClick={() => {
            if (saving === null) return
            setSettings({ network: saving })
            onBack()
          }}
        >
          Save
        </PillButton.Root>
        <p>Stored in this browser only</p>
      </WalletDrawer.Footer>
    </>
  )
}

export function SigningView({ onBack }: { onBack: () => void }): ReactNode {
  const settings = useSettings()
  const [draft, setDraft] = useState<SigningDraft>(() =>
    signingDraftFrom(settings.signing),
  )
  const saving = signingToSave(draft)
  const typed = draft.safe.trim()

  return (
    <>
      <ViewHeader title="Signing" onBack={onBack} />
      <WalletDrawer.Body>
        <fieldset>
          <legend className="sr-only">How reviews sign</legend>
          <ol className="flex flex-col gap-3">
            <li>
              <Choice
                name="signing"
                value="wallet"
                checked={draft.mode === "wallet"}
                onSelect={() => setDraft({ ...draft, mode: "wallet" })}
                title="Wallet"
                detail="Sign each step in your wallet"
              />
            </li>
            <li>
              <Choice
                name="signing"
                value="multisig"
                checked={draft.mode === "multisig"}
                onSelect={() => setDraft({ ...draft, mode: "multisig" })}
                title="Multisig"
                detail="Export each action as a Safe transaction batch"
              />
            </li>
            {draft.mode === "multisig" ? (
              <li>
                <TextBox
                  id="account-safe"
                  label="Safe on Mezo"
                  value={draft.safe}
                  onValueChange={(safe) => setDraft({ ...draft, safe })}
                  placeholder="0x"
                  status={
                    typed !== "" && saving === null
                      ? { tone: "negative", text: "Not a valid address" }
                      : null
                  }
                />
              </li>
            ) : null}
          </ol>
        </fieldset>
      </WalletDrawer.Body>
      <WalletDrawer.Footer className="flex flex-col items-center gap-4">
        <PillButton.Root
          size="lg"
          disabled={saving === null}
          onClick={() => {
            if (saving === null) return
            setSettings({ signing: saving })
            onBack()
          }}
        >
          Save
        </PillButton.Root>
        <p className="text-center">
          Reviews show Export for Safe instead of Sign
        </p>
      </WalletDrawer.Footer>
    </>
  )
}
