import type {
  ApiKeyRecord,
  EnvironmentSummary,
} from "@matchbox/contracts/console"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { lazy, type ReactNode, Suspense, useState } from "react"
import { Empty } from "../components/states"
import { shortDate } from "../lib/numbers"

function loadNewKey(): Promise<typeof import("./new-key-sheet")> {
  return import("./new-key-sheet")
}

function loadRevoke(): Promise<typeof import("./revoke-key-sheet")> {
  return import("./revoke-key-sheet")
}

function loadManage(): Promise<typeof import("./manage-key-sheet")> {
  return import("./manage-key-sheet")
}

const NewKeySheet = lazy(loadNewKey)
const ManageKeySheet = lazy(loadManage)
const RevokeKeySheet = lazy(loadRevoke)
const ShownOnce = lazy(() => import("./shown-once"))

const statusNames: Record<ApiKeyRecord["status"], string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
}

/** API keys for one environment (`WXZBHwQdbF`). */
export function ApiKeys({
  environment,
  keys,
}: {
  environment: EnvironmentSummary
  keys: ApiKeyRecord[]
}): ReactNode {
  const [created, setCreated] = useState<{
    name: string
    key: string
  } | null>(null)
  const [sheet, setSheet] = useState<
    | { kind: "new" }
    | { kind: "revoke"; apiKey: ApiKeyRecord }
    | { kind: "manage"; apiKey: ApiKeyRecord }
    | null
  >(null)
  const title = environment.kind === "live" ? "Live keys" : "Test keys"
  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-[24px] font-[650] text-ink">{title}</h2>
        <PillButton.Root
          onPointerEnter={() => void loadNewKey()}
          onFocus={() => void loadNewKey()}
          onClick={() => setSheet({ kind: "new" })}
        >
          <Icon name="plus" size={18} />
          New key
        </PillButton.Root>
      </div>
      {keys.length === 0 ? (
        <Empty title="No keys yet" />
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-[14.5px] text-sec">
              <th className="pb-3 font-normal">Name</th>
              <th className="pb-3 font-normal">Type</th>
              <th className="pb-3 font-normal max-md:hidden">Key</th>
              <th className="pb-3 font-normal max-md:hidden">Last used</th>
              <th className="pb-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((apiKey) => (
              <tr
                key={apiKey.id}
                className={`border-t border-line ${apiKey.status === "active" ? "" : "text-mut"}`}
              >
                <td className="py-4 text-[16px] font-semibold">
                  {apiKey.name}
                  {apiKey.status === "active" ? null : (
                    <span className="ml-2 text-[14px] font-normal">
                      {statusNames[apiKey.status]}
                    </span>
                  )}
                </td>
                <td className="py-4">
                  <span className="rounded-full bg-soft px-2.5 py-1 text-[13.5px] font-medium text-ink2">
                    {apiKey.kind === "secret" ? "Secret" : "Publishable"}
                  </span>
                </td>
                <td className="py-4 font-mono text-[14px] max-md:hidden">
                  {apiKey.displayPrefix}
                </td>
                <td className="py-4 text-[15px] text-sec max-md:hidden">
                  {apiKey.lastUsedAt === null
                    ? "Never"
                    : shortDate(apiKey.lastUsedAt)}
                </td>
                <td className="py-4 text-right">
                  {apiKey.status === "active" ? (
                    <PillButton.Root
                      intent="neutral"
                      size="sm"
                      className="mr-2 bg-soft"
                      onPointerEnter={() => void loadManage()}
                      onClick={() => setSheet({ kind: "manage", apiKey })}
                    >
                      Manage
                    </PillButton.Root>
                  ) : null}
                  {apiKey.status === "active" ? (
                    <PillButton.Root
                      intent="neutral"
                      size="sm"
                      className="bg-soft"
                      onPointerEnter={() => void loadRevoke()}
                      onClick={() => setSheet({ kind: "revoke", apiKey })}
                    >
                      Revoke
                    </PillButton.Root>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {environment.kind === "live" ? null : (
        <p className="mt-6 text-[14.5px] text-sec">Mezo Testnet</p>
      )}
      <Suspense fallback={null}>
        {sheet?.kind === "new" ? (
          <NewKeySheet
            environment={environment}
            onCreated={setCreated}
            onClose={() => setSheet(null)}
          />
        ) : sheet?.kind === "manage" ? (
          <ManageKeySheet
            apiKey={sheet.apiKey}
            onRotated={setCreated}
            onClose={() => setSheet(null)}
          />
        ) : sheet?.kind === "revoke" ? (
          <RevokeKeySheet
            apiKey={sheet.apiKey}
            onClose={() => setSheet(null)}
          />
        ) : null}
        {created === null ? null : (
          <ShownOnce
            title="Key created"
            name={created.name}
            secret={created.key}
            envName="MATCHBOX_API_KEY"
            onDone={() => setCreated(null)}
          />
        )}
      </Suspense>
    </>
  )
}
