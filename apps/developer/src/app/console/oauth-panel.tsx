import type { Environment } from "@matchbox/contracts/console"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import type { OAuthExtras } from "../data/console-api"
import { errorMessage } from "../lib/api-error"
import { OAuthAside } from "./consent-preview"
import { StepUpCancelledError, useStepUp } from "./step-up"

/**
 * OAuth for one environment (`ue1xxOLm6q`): redirect URIs and allowed
 * origins for publishable keys (scopes and the review are on the
 * Environments tab, `45HRaWcjCi`, as on Classic's environments page). Every change is a PUT from the browser; the server validates
 * URIs per environment kind (https only in live, localhost in test) and
 * clears verification when they change.
 */

function useAction(): {
  pending: string | null
  error: string | null
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>
  sheet: ReactNode
} {
  const router = useRouter()
  const stepUp = useStepUp()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function run(
    key: string,
    action: () => Promise<unknown>,
  ): Promise<boolean> {
    setPending(key)
    setError(null)
    try {
      await stepUp.run(action)
      await router.invalidate()
      return true
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
      return false
    } finally {
      setPending(null)
    }
  }
  return { pending, error, run, sheet: stepUp.sheet }
}

function UrlList({
  title,
  hint,
  placeholder,
  values,
  save,
}: {
  title: string
  hint: string
  placeholder: string
  values: string[]
  save: (next: string[]) => Promise<unknown>
}): ReactNode {
  const inputId = useId()
  const action = useAction()
  const [draft, setDraft] = useState("")

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault()
    const value = draft.trim()
    if (value === "" || values.includes(value)) return
    if (await action.run("add", () => save([...values, value]))) setDraft("")
  }

  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[22px] font-[650] text-ink">{title}</h3>
        <p className="text-[15px] text-sec">{hint}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {values.map((value) => (
          <li
            key={value}
            className="flex min-h-12 items-center gap-3 rounded-[16px] bg-soft pr-2 pl-4"
          >
            <span className="min-w-0 flex-1 break-all font-mono text-[14.5px] text-ink">
              {value}
            </span>
            <button
              type="button"
              aria-label={`Remove ${value}`}
              disabled={action.pending !== null}
              onClick={() =>
                void action.run(value, () =>
                  save(values.filter((entry) => entry !== value)),
                )
              }
              className="grid size-9 cursor-pointer place-items-center rounded-full text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              <Icon name="x" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={(event) => void add(event)} className="flex gap-3">
        <label htmlFor={inputId} className="sr-only">
          Add to {title}
        </label>
        <input
          id={inputId}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          className="h-12 min-w-0 flex-1 rounded-[16px] border border-line bg-bg px-4 font-mono text-[14.5px] text-ink outline-none focus:border-acc"
        />
        <PillButton.Root
          type="submit"
          intent="neutral"
          className="bg-soft"
          pending={action.pending === "add"}
        >
          Add
        </PillButton.Root>
      </form>
      {action.error === null ? null : (
        <p role="alert" className="text-[15px] font-medium text-neg">
          {action.error}
        </p>
      )}
      {action.sheet}
    </section>
  )
}

export function OAuthPanel({
  environment,
  extras,
}: {
  environment: Environment
  extras: OAuthExtras | null
}): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,592px)_400px] lg:justify-between">
      <div className="flex flex-col gap-12">
        <UrlList
          title="Redirect URIs"
          hint={
            environment.kind === "live"
              ? "Exact match, HTTPS only"
              : "Exact match, localhost allowed"
          }
          placeholder="https://"
          values={environment.redirectUris}
          save={async (uris) => {
            const { environments } = await import("../lib/api")
            return environments.replaceRedirectUris(environment.id, uris)
          }}
        />
        <UrlList
          title="Allowed origins"
          hint="Publishable keys"
          placeholder="https://"
          values={environment.origins}
          save={async (origins) => {
            const { environments } = await import("../lib/api")
            return environments.replaceOrigins(environment.id, origins)
          }}
        />
      </div>
      <OAuthAside extras={extras} />
    </div>
  )
}
