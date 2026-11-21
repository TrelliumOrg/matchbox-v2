/**
 * Whether the screens switch to a wallet that just connected. They do
 * when you connected it from the drawer, when no wallet was on screen,
 * and when the page showed your wallet as it was: the previous account,
 * or the one this browser connected last (its cookie, which the server
 * rendered a plain path like /rewards with). Someone else's wallet, viewed
 * on purpose, stays, and so does the Safe saved in Signing: its owner
 * connects there to sign as the Safe, so the page is theirs already.
 */
export default function followsAccount({
  address,
  showing,
  before,
  remembered,
  chose,
  savedSafe,
}: {
  /** The wallet that connected. */
  address: string
  /** The wallet on screen (`?address=`), if any. */
  showing: string | null
  /** The account before this one, in this tab. */
  before: string | null
  /** The own-wallet cookie, before this connection replaced it. */
  remembered: string | null
  /** Connected from the drawer. */
  chose: boolean
  /** The wallet on screen is the Safe saved in Signing. */
  savedSafe: boolean
}): boolean {
  const same = (a: string | null, b: string | null): boolean =>
    a !== null && b !== null && a.toLowerCase() === b.toLowerCase()
  if (same(showing, address) || savedSafe) return false
  return (
    chose ||
    showing === null ||
    same(showing, before) ||
    same(showing, remembered)
  )
}
