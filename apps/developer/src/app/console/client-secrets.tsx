import type {
  ClientSecretRecord,
  Environment,
} from "@matchbox/contracts/console"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import { useRouter } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useState } from "react"
import { Empty } from "../components/states"
import { errorMessage } from "../lib/api-error"
import { shortDate } from "../lib/numbers"
import { CopyField } from "./copy-field"
import { StepUpCancelledError, useStepUp } from "./step-up"

/** `maxActiveClientSecrets` in @matchbox/contracts/console (kept here so
 * the page does not load zod); a contract test pins the two together. */
export const maxActiveSecrets = 2

/** The token endpoint of Matchbox ID, where client secrets are used. */
const tokenEndpoint = "https://id.matchbox.markets/oauth/token"

const ShownOnce = lazy(() => import("./shown-once"))

/**
 * Client secrets for confidential OIDC clients (`Or71vVnUWj`): the client
 * ID, client type and token endpoint, then at most two active secrets, so
 * one can be rotated in before the other is revoked.
 */
export function ClientSecrets({
  environment,
  secrets,
}: {
  environment: Environment
  secrets: ClientSecretRecord[]
}): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const [hintClosed, setHintClosed] = useState(false)
  const activeSecrets = secrets.filter((secret) => secret.status === "active")
  const active = activeSecrets.length
  const rotateBy = active === 1 ? (activeSecrets[0]?.expiresAt ?? null) : null

  async function act(
    key: string,
    action: () => Promise<unknown>,
  ): Promise<void> {
    setPending(key)
    setError(null)
    try {
      await stepUp.run(action)
      await router.invalidate()
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  function createSecret(): void {
    void act("new", async () => {
      const { environments } = await import("../lib/api")
      const result = await environments.createClientSecret(environment.id, null)
      setCreated(result.secret)
    })
  }

  return (
    <>
      <dl className="mb-12 grid grid-cols-1 items-center gap-x-10 gap-y-4 sm:grid-cols-[164px_1fr]">
        <dt className="text-[16px] text-sec">Client ID</dt>
        <dd>
          <CopyField label="client ID" value={environment.clientId} />
        </dd>
        <dt id="client-type" className="text-[16px] text-sec">
          Client type
        </dt>
        <dd>
          <SegmentedControl.Root
            aria-labelledby="client-type"
            size="md"
            value={environment.clientType}
            disabled={pending !== null}
            onValueChange={(value) => {
              if (value !== "public" && value !== "confidential") return
              void act("type", async () => {
                const { environments } = await import("../lib/api")
                await environments.update(environment.id, {
                  clientType: value,
                })
              })
            }}
            className="w-[292px] max-w-full"
          >
            <SegmentedControl.Item value="confidential">
              Confidential
            </SegmentedControl.Item>
            <SegmentedControl.Item value="public">
              Public with PKCE
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </dd>
        <dt className="text-[16px] text-sec">Token endpoint</dt>
        <dd>
          <CopyField
            label="token endpoint"
            value={tokenEndpoint}
            shown={tokenEndpoint.slice("https://".length)}
          />
        </dd>
      </dl>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-[24px] font-[650] text-ink">Client secrets</h2>
        <span className="flex items-center gap-4">
          <span
            title="New secrets need a recent Google sign-in"
            className="flex items-center gap-1.5 text-[15px] text-sec"
          >
            <Icon name="lock" size={15} strokeWidth={1.8} />
            Google
          </span>
          <PillButton.Root
            intent="secondary"
            disabled={active >= maxActiveSecrets}
            pending={pending === "new"}
            onClick={createSecret}
          >
            <Icon name="plus" size={18} />
            New secret
          </PillButton.Root>
        </span>
      </div>
      {error === null ? null : (
        <p role="alert" className="mb-4 text-[15px] font-medium text-neg">
          {error}
        </p>
      )}
      {secrets.length === 0 ? (
        <Empty title="No client secrets" />
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line text-[14px] text-sec">
              <th className="pb-3 font-normal">Secret</th>
              <th className="pb-3 font-normal max-sm:hidden">Created</th>
              <th className="pb-3 font-normal max-sm:hidden">Expires</th>
              <th className="pb-3 font-normal">State</th>
              <th className="pb-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {secrets.map((secret) => (
              <tr key={secret.id} className="border-b border-line">
                <td className="py-4 font-mono text-[14px] text-ink">
                  {secret.displayPrefix}
                </td>
                <td className="py-4 text-[15.5px] text-ink max-sm:hidden">
                  {shortDate(secret.createdAt)}
                </td>
                <td className="py-4 text-[15.5px] text-ink max-sm:hidden">
                  {secret.expiresAt === null
                    ? "Never"
                    : shortDate(secret.expiresAt)}
                </td>
                <td className="py-4">
                  <span
                    className={`inline-flex h-6 items-center rounded-full px-2.5 text-[13.5px] font-semibold capitalize ${secret.status === "active" ? "bg-pos-soft text-pos" : "bg-soft text-sec"}`}
                  >
                    {secret.status}
                  </span>
                </td>
                <td className="py-4 text-right">
                  {secret.status === "active" ? (
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() =>
                        void act(secret.id, async () => {
                          const { clientSecrets } = await import("../lib/api")
                          await clientSecrets.revoke(secret.id)
                        })
                      }
                      className="cursor-pointer text-[15.5px] font-semibold text-neg underline underline-offset-[3px] disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-4 text-[14.5px] text-sec">
        {active} of {maxActiveSecrets} active
      </p>
      {rotateBy === null || hintClosed ? null : (
        <aside className="mt-7 flex max-w-[620px] items-center gap-4 rounded-[24px] bg-soft p-5">
          <span className="grid size-11 flex-none place-items-center rounded-full bg-bg text-ink">
            <Icon name="rotate-cw" size={18} strokeWidth={1.8} />
          </span>
          <p className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-3 text-[16px] text-ink">
              Rotate by {shortDate(rotateBy)}
              <button
                type="button"
                onClick={createSecret}
                className="cursor-pointer font-semibold underline underline-offset-[3px]"
              >
                New secret
              </button>
            </span>
            <span className="block text-[14.5px] text-sec">
              Add a second, deploy it, revoke the first
            </span>
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setHintClosed(true)}
            className="grid size-9 flex-none cursor-pointer place-items-center rounded-full text-sec hover:bg-bg"
          >
            <Icon name="x" size={16} strokeWidth={2} />
          </button>
        </aside>
      )}
      {stepUp.sheet}
      {created === null ? null : (
        <Suspense fallback={null}>
          <ShownOnce
            title="Secret created"
            name="Client secret"
            secret={created}
            envName="MATCHBOX_CLIENT_SECRET"
            onDone={() => setCreated(null)}
          />
        </Suspense>
      )}
    </>
  )
}
