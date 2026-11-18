// Decoder versions. A database is built with one version
// (matchbox.projection_state) and keeps projecting with it: the Worker runs
// whichever supported version the tables were built with, so deploying a
// new decoder never halts projection. A replay (`rebuild:history --
// --replay`) rebuilds the tables with DECODER_VERSION. A database built
// with a version outside SUPPORTED_DECODER_VERSIONS halts until replayed.
//
// v2: voters from the network start, voter bribe rewards, reward deposits,
//     claim token ids, INCENTIVE_ADDED epochs, mUSD trove updates.
// v3: escrows (veBTC, veMEZO) from the network start, so locks created
//     before the explorer's start block (7,739,500) exist with their real
//     history; their rows before that block are warehouse-only. And a
//     warehouse-only LOCK_BOOST_UPDATED row for every UpdateBoost. And
//     each escrow's real MAXTIME (veBTC 28 days, veMEZO 208 weeks) where v2
//     used the explorer's 4 x 365 days for both: the end UnlockPermanent
//     sets, and the duration of a permanent lock.

// Not a version change: the sMUSD gauge's reward contracts
// (WAREHOUSE_LEGACY_POOL_REWARDS, Nov 2026) are decoded under every
// version. Their rows are warehouse-only, and no other row or state reads
// them, so tables that lack them are not inconsistent: they are only missing
// rows. `reproject:legacy-rewards` adds the missing rows without a replay;
// any replay also produces them.

/** The version a fresh build or a replay uses. */
export const DECODER_VERSION = 3

/** Versions the Worker can keep projecting with. */
export const SUPPORTED_DECODER_VERSIONS: readonly number[] = [2, 3]

/** First version that projects the escrows from the network start. */
export const ESCROW_PREHISTORY_VERSION = 3

/** First version that writes LOCK_BOOST_UPDATED rows. */
export const LOCK_BOOST_ROWS_VERSION = 3

/** First version that uses each escrow's own MAXTIME. */
export const ESCROW_MAXTIME_VERSION = 3
