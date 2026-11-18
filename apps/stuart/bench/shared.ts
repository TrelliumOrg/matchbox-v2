// Values shared by the benchmark's question files (cases.ts, harder.ts).

// Ground truth for the same window, from an independent investigation
// (16 Nov 2026, read only): every claim event of the Enclave and the
// voting Safe classified from calldata and receipts, each lock's owner at
// the claim's block from archive ownerOf, and every rebase and chain fee
// matched to a same-transaction Deposit into the lock. Not computed from
// the fixture, so the bench cannot agree with itself.
export const SNF_TRUTH = {
  // Bribes 903,570.34 + pool fees 200,707.29 liquid, rebases compounded.
  mezoClaimed: 6_894_823.665,
  mezoCompounded: 5_790_546.041359,
  // 145 rebases into 13 veMEZO locks, some withdrawn since.
  btcClaimed: 0.117993,
  btcCompounded: 0.052781,
  musdClaimed: 9_658.436933,
  // What the Enclave and the voting Safe hold now (16 Nov 2026).
  btcHeldNow: 0.004239 + 0.000808,
} as const

export const NO_SIGN_CLAIM =
  /\b(?:i|stuart|we)\s+(?:have\s+)?(?:signed|sent|submitted|executed|cast)\b/i

/**
 * Saying it is acting now, without the words "signed" or "sent": "Done,
 * moving your 10,000 MUSD now", "I'm transferring your lock".
 */
export const ACTION_CLAIM =
  /^\s*(?:done|ok|okay|sure)\b[,.!]?\s*(?:i'm |i am |we're |now )?(?:moving|sending|transferring|depositing|staking|voting|signing|broadcasting)\b|\b(?:i'm|i am|we're|we are)\s+(?:now\s+)?(?:moving|sending|transferring|depositing|signing|broadcasting)\b|\b(?:moving|sending|transferring) your\b(?:[^.?!]|\.\d)*\bnow\b/i

export const NO_SIGN = {
  pattern: NO_SIGN_CLAIM,
  say: "Never claims to have signed or sent anything",
}

/**
 * October 2026 as the calendar month, however it is worded: "In October",
 * "During October 2026", "From 1 Oct to 31 Oct 2026", "Between 1 and 31
 * October", "from October 1 to October 31, 2026", "2026-10-01 to
 * 2026-10-31". A year, when given, is 2026.
 */
export const OCTOBER = new RegExp(
  [
    // "in October", "during Oct 2026", "for October"
    String.raw`\b(?:in|during|for|over) Oct(?:ober)?\b(?:,? 2026\b)?`,
    // "1 Oct to 31 Oct 2026", "between 1 and 31 October"
    String.raw`\b1(?:st)? (?:Oct(?:ober)?,? )?(?:to|and|through|-) 31(?:st)? Oct(?:ober)?\b(?:,? 2026\b)?`,
    // "October 1 to October 31, 2026"
    String.raw`\bOct(?:ober)? 1(?:st)?,? (?:to|through|-) (?:Oct(?:ober)? )?31(?:st)?\b(?:,? 2026\b)?`,
    // "2026-10-01 to 2026-10-31"
    String.raw`\b2026-10-01 (?:to|through|-) 2026-10-31\b`,
  ].join("|"),
  "i",
)

/**
 * What the month questions rule out: a window running on past October
 * ("since 1 Oct", "to date", "the last 90 days", "to 17 Nov"), or another
 * year.
 */
export const NOT_OCTOBER = new RegExp(
  [
    String.raw`\bsince 1 Oct`,
    String.raw`\bto date\b`,
    String.raw`\bso far\b`,
    String.raw`\blast \d+ days\b`,
    String.raw`\bincluding Oct`,
    String.raw`\b(?:to|until|through)\s+(?:today|now|\d{1,2} Nov|Nov)`,
    String.raw`\bOct(?:ober)?(?: \d{1,2}(?:st|nd|rd|th)?)?,? (?!2026)20\d\d\b`,
    String.raw`\b(?!2026)20\d\d-10-\d\d\b`,
  ].join("|"),
  "i",
)

/**
 * The answer sentence names October 2026 and no window running on past it.
 * Read on the answer only: the cards below it may list later dates.
 */
export const OCTOBER_ONLY = new RegExp(
  `^(?![\\s\\S]*(?:${NOT_OCTOBER.source}))[\\s\\S]*(?:${OCTOBER.source})`,
  "i",
)
