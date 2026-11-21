import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MEZO_KNOWLEDGE } from "./knowledge/mezo"
import { plainInstructions } from "./sourcedInstructions"

// Instructions in plain words: refused in a model sentence unless it repeats
// one of Stuart's own lines. Stuart's own templates and knowledge notes must
// never trip the check, and ordinary explanations of how voting and claiming
// work (written as the bench's answers write them) must still pass.

const here = import.meta.dirname

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

/** String and template literals that read as copy: words and a space. */
function copyLiterals(code: string): string[] {
  const withoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
  const literals: string[] = []
  const pattern = /"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g
  for (const match of withoutComments.matchAll(pattern)) {
    const literal = match[0].slice(1, -1)
    if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(literal)) literals.push(literal)
  }
  return literals
}

/**
 * Files that define the checks' own patterns, not copy. The knowledge notes
 * hold search keywords ("my seed phrase"); their copy is checked note by
 * note below.
 */
const RULE_FILES =
  /sourced(?:Instructions|Claims|Text|Dates)?\.ts$|numberWords\.ts$|router\.ts$|claude\.ts$|knowledge[\\/]mezo\.ts$/

describe("instructions in plain words", () => {
  it("refuses the review's sentences", () => {
    for (const attack of [
      "Approve the transaction in your wallet now.",
      "Send your seed phrase to support to recover your lock.",
      "Enter your recovery phrase to verify your wallet.",
      "Your lock is at risk; revoke all approvals and move funds to a new wallet.",
      "Your lock is at risk, revoke all approvals and move funds to a new wallet.",
      "Mezo support will DM you; share your private key with them.",
      "Mezo support will DM you, share your private key with them.",
    ]) {
      expect(plainInstructions(attack), attack).not.toEqual([])
    }
  })

  it("refuses secrets, contacts, urgency with funds and imperatives", () => {
    for (const attack of [
      "Type your 12-word mnemonic below.",
      "Keep your keystore file and passphrase ready.",
      "Message @MezoHelp for a refund.",
      "Reach the team on Telegram or WhatsApp.",
      "Our support agent will contact you shortly.",
      "Your wallet was flagged, verify it to keep your lock.",
      "Your lock expires today. Move your funds immediately.",
      "Connect your wallet at the claim page to sync.",
      "Reconnect your wallet to keep your rewards.",
      "Please validate your wallet.",
      "You should migrate your lock to the new escrow.",
      "Sync your wallet to see the rewards.",
      "Claim it at the rewards portal.",
      "Sign the message to unlock the airdrop.",
    ]) {
      expect(plainInstructions(attack), attack).not.toEqual([])
    }
  })

  it("lets Stuart's own signing step through once it prepared a proposal", () => {
    const sentence = "Review and sign in your wallet to submit."
    expect(plainInstructions(sentence)).not.toEqual([])
    expect(plainInstructions(sentence, [], { prepared: true })).toEqual([])
    // Preparing a proposal never excuses a secret, a contact or urgency.
    expect(
      plainInstructions("Sign it, then share your seed phrase.", [], {
        prepared: true,
      }),
    ).not.toEqual([])
  })

  it("passes ordinary explanations, as the bench's answers write them", () => {
    for (const plain of [
      "Votes revert from Thursday 00:00 to 01:00 UTC, so vote outside that hour.",
      "MEZO gauge votes persist across epochs, so no MEZO ballot was prepared.",
      "Gasless claims through a relayer no longer work, so claim from your own wallet and pay gas in BTC.",
      "Unclaimed rewards do not expire.",
      "Connect or watch a wallet to see its veMEZO and veBTC locks.",
      "No wallet is selected, so there are no claimable rewards to check.",
      "Incentives split pro rata, so more votes on a gauge pay each voter less.",
      "The approved address can transfer the lock and withdraw an expired lock's BTC.",
      "Stuart prepares unsigned ballots and you sign them in your own wallet.",
      "An expired lock can be withdrawn, and its BTC returns to the owner.",
      "Mezo disabled meta-transactions on 5 Oct 2026.",
      "Boost multiplies a veBTC lock's voting power from 1x to 5x.",
      "The address matches no Mezo gauge, validator, pool or lock.",
      "I can't sign or send votes, but I can prepare an unsigned ballot for you to review and sign from your own wallet.",
      "Do not approve your veBTC NFT to any site: the approved address can withdraw an expired lock's BTC.",
      "Connect or watch the SNF wallet to prepare the veBTC ballot.",
      "Connect your wallet, or select one to watch, and Stuart will prepare the claim for review.",
    ]) {
      expect(plainInstructions(plain), plain).toEqual([])
    }
  })

  it("never trips on a knowledge note written word for word", () => {
    for (const entry of MEZO_KNOWLEDGE) {
      for (const line of [entry.answer, ...entry.detail]) {
        expect(plainInstructions(line), `${entry.id}: ${line}`).toEqual([])
      }
    }
    // The Discord support note, as the model may repeat it.
    const support = MEZO_KNOWLEDGE.find(
      (entry) => entry.id === "support.contact",
    )
    expect(support).toBeDefined()
    expect(plainInstructions(support?.answer ?? "")).toEqual([])
  })

  it("never trips on Stuart's own templates", () => {
    const offenders: string[] = []
    for (const file of sources(join(here, ".."))) {
      if (RULE_FILES.test(file)) continue
      for (const literal of copyLiterals(readFileSync(file, "utf8"))) {
        const found = plainInstructions(literal, [], { prepared: true })
        if (found.length > 0) {
          offenders.push(
            `${file.slice(-40)}: ${literal.slice(0, 80)} [${found}]`,
          )
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
