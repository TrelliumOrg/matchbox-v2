import type { App } from "@matchbox/contracts/console"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { useRouter } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { errorMessage } from "../lib/api-error"
import { shortDate } from "../lib/numbers"
import { AppMark } from "./app-row"
import { CopyField } from "./copy-field"
import { StepUpCancelledError, useStepUp } from "./step-up"

/** The description limit of `appProfileFields` in the console contract. */
export const descriptionLimit = 500

const links = [
  { key: "websiteUrl", label: "Website", type: "url" },
  { key: "supportEmail", label: "Support email", type: "email" },
  { key: "privacyUrl", label: "Privacy policy", type: "url" },
  { key: "termsUrl", label: "Terms", type: "url" },
] as const

type FieldKey =
  | "name"
  | "description"
  | "logoUrl"
  | (typeof links)[number]["key"]

function initial(app: App): Record<FieldKey, string> {
  return {
    name: app.name,
    description: app.description ?? "",
    logoUrl: app.logoUrl ?? "",
    websiteUrl: app.websiteUrl ?? "",
    privacyUrl: app.privacyUrl ?? "",
    termsUrl: app.termsUrl ?? "",
    supportEmail: app.supportEmail ?? "",
  }
}

/** Empty optional fields clear the value (null), as Classic sent them. */
function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

const input =
  "h-12 w-full rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink outline-none focus:border-acc"

/**
 * App settings (`vUIIn3fAzd`): the identity and links people see on the
 * consent page, saved together, then retiring the app; beside them the
 * app's ID, dates and environments. The server validates the URLs (HTTPS)
 * and re-checks verification when the consent profile changes.
 */
export function SettingsPanel({ app }: { app: App }): ReactNode {
  const router = useRouter()
  const stepUp = useStepUp()
  const prefix = useId()
  const [values, setValues] = useState(() => initial(app))
  const [pending, setPending] = useState<"save" | "retire" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const dirty = Object.entries(initial(app)).some(
    ([key, value]) => values[key as FieldKey] !== value,
  )

  function field(key: FieldKey) {
    return {
      id: `${prefix}-${key}`,
      value: values[key],
      onChange: (event: { target: { value: string } }) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    }
  }

  async function act(
    kind: "save" | "retire",
    action: () => Promise<unknown>,
  ): Promise<void> {
    setPending(kind)
    setError(null)
    try {
      await stepUp.run(action)
      setConfirming(false)
      await router.invalidate()
    } catch (caught) {
      if (!(caught instanceof StepUpCancelledError))
        setError(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    void act("save", async () => {
      const { apps } = await import("../lib/api")
      await apps.update(app.id, {
        name: values.name.trim(),
        description: nullable(values.description),
        logoUrl: nullable(values.logoUrl),
        websiteUrl: nullable(values.websiteUrl),
        privacyUrl: nullable(values.privacyUrl),
        termsUrl: nullable(values.termsUrl),
        supportEmail: nullable(values.supportEmail),
      })
    })
  }

  const logo = nullable(values.logoUrl)

  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,640px)_352px] lg:justify-between">
      <div className="flex flex-col">
        <form onSubmit={save} className="flex flex-col">
          <h2 className="text-[24px] font-[650] text-ink">Identity</h2>
          <label
            htmlFor={`${prefix}-name`}
            className="mt-5 text-[14px] text-sec"
          >
            Name
          </label>
          <input
            {...field("name")}
            required
            maxLength={80}
            className={`mt-2 ${input}`}
          />
          <p className="mt-6 flex justify-between text-[14px] text-sec">
            <span>Slug</span>
            <span>Read only</span>
          </p>
          <p className="mt-2 flex h-12 items-center rounded-[16px] bg-soft px-4 font-mono text-[15px] text-ink2">
            {app.slug}
          </p>
          <p className="mt-6 flex justify-between text-[14px] text-sec">
            <label htmlFor={`${prefix}-description`}>Description</label>
            <span className="tabular-nums">
              {values.description.length} of {descriptionLimit}
            </span>
          </p>
          <textarea
            {...field("description")}
            maxLength={descriptionLimit}
            rows={3}
            className="mt-2 min-h-24 w-full rounded-[16px] border border-line bg-bg px-4 py-3 text-[16px] text-ink outline-none focus:border-acc"
          />
          <label
            htmlFor={`${prefix}-logoUrl`}
            className="mt-6 text-[14px] text-sec"
          >
            Logo URL
          </label>
          <span className="mt-2 flex gap-3">
            <input
              {...field("logoUrl")}
              type="url"
              className={`${input} font-mono text-[15px] max-md:text-[16px]`}
            />
            <AppMark app={{ name: values.name || app.name, logoUrl: logo }} />
          </span>

          <h2 className="mt-10 text-[24px] font-[650] text-ink">Links</h2>
          <div className="mt-5 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
            {links.map((link) => (
              <span key={link.key} className="flex flex-col">
                <label
                  htmlFor={`${prefix}-${link.key}`}
                  className="text-[14px] text-sec"
                >
                  {link.label}
                </label>
                <input
                  {...field(link.key)}
                  type={link.type}
                  className={`mt-2 ${input} ${link.type === "url" ? "font-mono text-[15px] max-md:text-[16px]" : ""}`}
                />
              </span>
            ))}
          </div>
          <span className="mt-7 flex gap-3">
            <PillButton.Root
              type="submit"
              disabled={!dirty}
              pending={pending === "save"}
            >
              Save
            </PillButton.Root>
            <PillButton.Root
              intent="neutral"
              className="bg-soft"
              disabled={!dirty || pending !== null}
              onClick={() => setValues(initial(app))}
            >
              Discard
            </PillButton.Root>
          </span>
        </form>

        {error === null ? null : (
          <p role="alert" className="mt-4 text-[15px] font-medium text-neg">
            {error}
          </p>
        )}

        {app.status === "retired" ? null : (
          <section aria-labelledby="retire-title" className="mt-12">
            <h2 id="retire-title" className="text-[24px] font-[650] text-ink">
              Retire
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-4 rounded-[20px] border border-line p-5">
              <p className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold text-ink">
                  Retire app
                </span>
                <span className="block text-[15px] text-sec">
                  Revokes all keys, secrets and grants
                </span>
              </p>
              <span
                title="Needs a recent Google sign-in"
                className="flex items-center gap-1.5 text-[15px] text-sec"
              >
                <Icon name="lock" size={15} strokeWidth={1.8} />
                Google
              </span>
              {confirming ? (
                <span className="flex gap-2">
                  <PillButton.Root
                    intent="neutral"
                    className="bg-soft"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </PillButton.Root>
                  <PillButton.Root
                    intent="destructive"
                    pending={pending === "retire"}
                    onClick={() =>
                      void act("retire", async () => {
                        const { apps } = await import("../lib/api")
                        await apps.retire(app.id)
                      })
                    }
                  >
                    Retire {app.name}
                  </PillButton.Root>
                </span>
              ) : (
                <PillButton.Root
                  intent="neutral"
                  className="bg-neg-soft text-neg"
                  onClick={() => setConfirming(true)}
                >
                  Retire app
                </PillButton.Root>
              )}
            </div>
          </section>
        )}
      </div>

      <aside className="h-fit rounded-[24px] bg-soft p-5">
        <p className="text-[14.5px] text-sec">App ID</p>
        <span className="mt-2 block">
          <CopyField label="app ID" value={app.id} />
        </span>
        <dl className="mt-4 flex flex-col gap-2.5 text-[15.5px]">
          <div className="flex justify-between gap-4">
            <dt className="text-sec">Created</dt>
            <dd className="text-ink">{shortDate(app.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-sec">Updated</dt>
            <dd className="text-ink">{shortDate(app.updatedAt)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sec">Environments</dt>
            <dd className="flex items-center gap-2 text-sec">
              {app.environments.map((environment) => (
                <span
                  key={environment.id}
                  title={environment.kind === "live" ? "Live" : "Test"}
                >
                  <Icon
                    name={
                      environment.kind === "live" ? "globe" : "flask-conical"
                    }
                    size={17}
                    strokeWidth={1.8}
                  />
                  <span className="sr-only">
                    {environment.kind === "live" ? "Live" : "Test"}
                  </span>
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </aside>
      {stepUp.sheet}
    </div>
  )
}
