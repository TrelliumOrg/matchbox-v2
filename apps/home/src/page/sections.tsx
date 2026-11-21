import { FeedbackEntry, FeedbackIcon } from "@matchbox/feedback-ui/entry"
import * as DocsLockup from "@matchbox/ui/docs-lockup"
import { Glyph, Icon, shapes } from "@matchbox/ui/icons"
import * as Lockup from "@matchbox/ui/lockup"
import {
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { DiscordGlyph, GaugeGlyph, StuartDog } from "./glyphs"
import { links } from "./links"
import { StuartQuestions } from "./stuart"
import { ThemeSwitch, useThemeMode } from "./theme-switch"

/**
 * The homepage's static parts, top to bottom after the two live cards
 * (frames `hf-header`, `hf-hero`, `hf-pair`, `hf-support`, `hf-classic`,
 * `hf-footer`). The ID and Developer screens and the Classic window are
 * pictures of those products: decorative, never anyone's data.
 */

const nav = [
  { label: "Pro", href: links.pro },
  { label: "Matchscan", href: links.scan },
  { label: "ID", href: links.id },
  { label: "Developer", href: links.developer },
  { label: "Docs", href: links.docs },
] as const

function Out(): ReactNode {
  return (
    <Icon name="arrow-up-right" size={15} strokeWidth={2.2} className="ic" />
  )
}

const menuId = "home-menu"

/**
 * The header. On the phone (the 390 frame) it is the lockup and a round
 * menu button; the button opens a native popover with the products and
 * the theme switch, as Matchscan's More menu does, so it opens, closes on
 * Escape or a tap outside, and keeps its place in the tab order with no
 * script at all.
 */
export function Header(): ReactNode {
  const theme = useThemeMode()
  return (
    <header className="hd">
      <a href="/" aria-label="Matchbox">
        <Lockup.Root product="matchbox" height={22} aria-hidden="true" />
      </a>
      <nav aria-label="Products">
        {nav.map((item) => (
          <a key={item.label} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      <div className="r">
        <ThemeSwitch name="theme" {...theme} />
        <a className="pill p2" href={links.pro}>
          Open Pro
        </a>
        <button
          type="button"
          className="mb"
          popoverTarget={menuId}
          aria-label="Menu"
        >
          <Glyph shape={shapes.menu} size={20} strokeWidth={1.9} />
        </button>
      </div>
      <div id={menuId} popover="auto" className="menu">
        <nav aria-label="Menu">
          <ul>
            {nav.map((item) => (
              <li key={item.label}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mtheme">
          <span aria-hidden="true">Theme</span>
          <ThemeSwitch name="theme-menu" {...theme} />
        </div>
      </div>
    </header>
  )
}

export function Hero(): ReactNode {
  return (
    <section className="hero">
      <h1>Use Mezo with Matchbox</h1>
      <p>Vote on gauges, explore activity and build on Mezo.</p>
    </section>
  )
}

/**
 * On the phone the pair is a row that scrolls sideways. Browsers leave a
 * focused link that is partly in view where it is, so a card brings
 * itself fully in when anything in it takes focus. Where the card is
 * already in view (always, wider than the phone) this does nothing.
 */
function showCard(event: ReactFocusEvent<HTMLElement>): void {
  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })
}

export function Pair(): ReactNode {
  return (
    <section className="b2" aria-label="Matchbox ID and Matchbox Developer">
      <article className="pc" aria-labelledby="id-title" onFocus={showCard}>
        <div className="strip s-id" />
        <div className="in">
          <div className="tx">
            <h2 id="id-title" className="sr-only">
              Matchbox ID
            </h2>
            <Lockup.Root product="id" height={22} aria-hidden="true" />
            <p className="l2">Sign in to apps with your wallet, no fee.</p>
            <a className="lnk" href={links.id}>
              Open Matchbox ID
              <Out />
            </a>
          </div>
          <div className="mini" aria-hidden="true">
            <b className="mt">Allow Gauge Scout to sign you in</b>
            <div className="mls">
              <div className="cr">
                <span className="ci">
                  <Icon name="key-round" size={16} className="ic" />
                </span>
                <b>Sign-in ID</b>
                <em>Required</em>
              </div>
              <div className="cr">
                <span className="ci">
                  <Icon name="wallet" size={16} className="ic" />
                </span>
                <b>Wallet</b>
                <em>Required</em>
              </div>
              <div className="cr">
                <span className="ci">
                  <DiscordGlyph />
                </span>
                <b>Discord ID</b>
                <span className="sw" />
              </div>
            </div>
          </div>
        </div>
      </article>
      <article className="pc" aria-labelledby="dev-title" onFocus={showCard}>
        <div className="strip s-dev" />
        <div className="in">
          <div className="tx">
            <h2 id="dev-title" className="sr-only">
              Matchbox Developer
            </h2>
            <Lockup.Root
              product="developer"
              form="short"
              height={22}
              aria-hidden="true"
            />
            <p className="l2">API keys, OAuth apps and Mezo Earn data.</p>
            <a className="lnk" href={links.developer}>
              Open Matchbox Developer
              <Out />
            </a>
          </div>
          <div className="mini" aria-hidden="true">
            <div className="mt">
              <span className="gs">
                <GaugeGlyph />
              </span>
              Gauge Scout
              <span className="chip ok" style={{ marginLeft: "auto" }}>
                Active
              </span>
            </div>
            <div className="mls">
              <div className="kr">
                <div>
                  <b>Production server</b>
                  <span className="mono">mbx_sk_live_…9TbR</span>
                </div>
                <span className="chip">Secret</span>
              </div>
              <div className="kr">
                <div>
                  <b>Browser widget</b>
                  <span className="mono">mbx_pk_live_…4Qa2</span>
                </div>
                <span className="chip">Publishable</span>
              </div>
            </div>
          </div>
        </div>
      </article>
    </section>
  )
}

export function Support(): ReactNode {
  const stuartRef = useRef<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // Hover and focus anywhere in the Stuart strip pause its questions.
  useEffect(() => {
    const strip = stuartRef.current
    if (strip === null) return
    const enter = (): void => setHovered(true)
    const leave = (): void => setHovered(false)
    const focusIn = (): void => setFocused(true)
    const focusOut = (event: FocusEvent): void => {
      if (
        !(
          event.relatedTarget instanceof Node &&
          strip.contains(event.relatedTarget)
        )
      ) {
        setFocused(false)
      }
    }
    strip.addEventListener("pointerenter", enter)
    strip.addEventListener("pointerleave", leave)
    strip.addEventListener("focusin", focusIn)
    strip.addEventListener("focusout", focusOut)
    return () => {
      strip.removeEventListener("pointerenter", enter)
      strip.removeEventListener("pointerleave", leave)
      strip.removeEventListener("focusin", focusIn)
      strip.removeEventListener("focusout", focusOut)
    }
  }, [])
  return (
    <section className="b3" aria-label="Docs and Stuart">
      <div className="si">
        <div>
          <h2 className="sr-only">Matchbox Docs</h2>
          <DocsLockup.Root height={22} aria-hidden="true" />
          <div className="t2">Every product, explained once.</div>
        </div>
        <a className="lnk" href={links.docs}>
          Read the docs
          <Out />
        </a>
      </div>
      <div className="si" ref={stuartRef}>
        <span className="dogb" aria-hidden="true">
          <StuartDog />
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: "inherit" }}>
            <b>Stuart</b>
          </h2>
          <div className="t2" style={{ marginTop: 2 }}>
            <StuartQuestions paused={hovered || focused} />
          </div>
        </div>
        <a className="lnk" href={links.pro}>
          Ask in Pro
          <Out />
        </a>
      </div>
    </section>
  )
}

export function Classic(): ReactNode {
  return (
    <section className="cl" aria-labelledby="classic-title">
      <div className="tx">
        <h2 id="classic-title" className="sr-only">
          Matchbox Classic
        </h2>
        <Lockup.Root product="classic" height={22} aria-hidden="true" />
        <p className="l2">The original Matchbox app</p>
        <a className="lnk" href={links.classic}>
          Open Classic
          <Out />
        </a>
      </div>
      <div className="clwin" aria-hidden="true">
        <div className="clhd">
          <span className="lg">
            <Lockup.Root product="matchbox" form="icon" height={14} />
            <span className="wm">MATCHBOX</span>
          </span>
          <nav>
            <span className="on">
              <b>&gt;</b>dashboard
            </span>
            <span>veMEZO</span>
            <span>veBTC</span>
            <span>pools</span>
            <span>MEZO gauges</span>
            <span>
              more
              <Icon
                name="chevron-down"
                size={11}
                strokeWidth={2}
                className="ic"
              />
            </span>
          </nav>
        </div>
        <div className="clbd">
          <h4>
            <b>$</b> dashboard --status
          </h4>
          <p>Track your veBTC and veMEZO positions</p>
          <div className="clcd">Connect your wallet to view your dashboard</div>
        </div>
      </div>
    </section>
  )
}

export function Footer(): ReactNode {
  return (
    <footer className="ft">
      <Lockup.Root product="matchbox" height={22} />
      <nav aria-label="Footer">
        {nav.map((item) => (
          <a key={item.label} href={item.href} data-tap="">
            {item.label}
          </a>
        ))}
        <a href={links.classic} data-tap="">
          Classic
        </a>
      </nav>
      <div className="lg">
        <a href={links.privacy} data-tap="">
          Privacy
        </a>
        {import.meta.env.VITE_FEEDBACK_URL ? (
          <FeedbackEntry
            endpoint={import.meta.env.VITE_FEEDBACK_URL}
            surface="home"
            className="inline-flex cursor-pointer items-center gap-2 rounded-md outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            <FeedbackIcon size={16} strokeWidth={1.9} />
            Feedback
          </FeedbackEntry>
        ) : null}
      </div>
    </footer>
  )
}
