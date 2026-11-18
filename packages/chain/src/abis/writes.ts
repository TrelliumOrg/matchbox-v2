import { parseAbi } from "viem"

// The write surface Pro signs: the veBTC and veMEZO escrows and the four
// voters, with the reads a transaction review needs and every custom error,
// so viem can name a revert instead of returning hex. Signatures and error
// names come from the verified implementations on api.explorer.mezo.org
// (VeBTC 0x41d0…5aE3, VeMEZO 0x38FB…0d9c, BoostVoter 0xA696…7624,
// PoolsVoter 0xA620…1465, ValidatorsVoter 0xd96f…F157, ThirdPartyVoter
// 0x8D69…64dC), read 8 Nov 2026.
//
// Deliberately absent: ERC-721 `approve` and `setApprovalForAll`. On these
// escrows an approval is custody (the approved address can transfer, merge
// and withdraw the lock), so Pro never asks for one. A transfer is the
// owner's own `safeTransferFrom`, which refuses a contract recipient that
// cannot hold the lock.
//
// Grant locks: `vestingEnd` is non-zero for a lock created as a vesting
// grant, and add, merge (either side) and split revert UnvestedGrantNFT until
// it passes. `escrowType` is 0 for a normal lock, 1 for a lock deposited into
// a managed lock and 2 for the managed lock itself.

/**
 * veBTC and veMEZO: create, add, extend, merge, withdraw, auto max on and
 * off, transfer.
 */
export const VOTING_ESCROW_WRITE_ABI = parseAbi([
  "function token() view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function locked(uint256 tokenId) view returns ((int128 amount, uint256 end, bool isPermanent, uint256 boost))",
  "function voted(uint256 tokenId) view returns (bool)",
  "function votedVoters(uint256 tokenId) view returns (address[])",
  "function votingPowerOfNFT(uint256 tokenId) view returns (uint256)",
  "function vestingEnd(uint256 _tokenId) view returns (uint256)",
  "function escrowType(uint256 tokenId) view returns (uint8)",
  "function createLock(uint256 _value, uint256 _lockDuration) returns (uint256)",
  "function increaseAmount(uint256 _tokenId, uint256 _value)",
  "function increaseUnlockTime(uint256 _tokenId, uint256 _lockDuration)",
  "function merge(uint256 _from, uint256 _to)",
  "function withdraw(uint256 _tokenId)",
  "function lockPermanent(uint256 _tokenId)",
  "function unlockPermanent(uint256 _tokenId)",
  "function safeTransferFrom(address _from, address _to, uint256 _tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "error AlreadyVoted()",
  "error AmountTooBig()",
  "error ERC721ReceiverRejectedTokens()",
  "error ERC721TransferToNonERC721ReceiverImplementer()",
  "error LockDurationNotInFuture()",
  "error LockDurationTooLong()",
  "error LockExpired()",
  "error LockNotExpired()",
  "error NoLockFound()",
  "error NonExistentToken()",
  "error NotApprovedOrOwner()",
  "error NotManagedOrNormalNFT()",
  "error NotNormalNFT()",
  "error NotOwner()",
  "error NotPermanentLock()",
  "error OwnershipChange()",
  "error PermanentLock()",
  "error SameNFT()",
  "error UnvestedGrantNFT()",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error ZeroBalance()",
])

/**
 * One ABI for BoostVoter, PoolsVoter, ValidatorsVoter and ThirdPartyVoter.
 * PoolsVoter votes on pool addresses (`poolForGauge`) and has no
 * `addBribes`; pool incentives go to the gauge's bribe contract directly.
 */
export const VOTER_WRITE_ABI = parseAbi([
  "function vote(uint256 _tokenId, address[] _targets, uint256[] _weights)",
  "function reset(uint256 _tokenId)",
  "function claimBribes(address[] _bribes, address[][] _tokens, uint256 _tokenId)",
  "function claimFees(address[] _fees, address[][] _tokens, uint256 _tokenId)",
  "function addBribes(address _gauge, address[] _tokens, uint256[] _amounts)",
  "function lastVoted(uint256 tokenId) view returns (uint256)",
  "function isWhitelistedNFT(uint256 tokenId) view returns (bool)",
  "function isWhitelistedToken(address token) view returns (bool)",
  "function poolForGauge(address gauge) view returns (address)",
  "function gaugeToBribe(address gauge) view returns (address)",
  "function gaugeToFees(address gauge) view returns (address)",
  "function isAlive(address gauge) view returns (bool)",
  "error AlreadyVotedOrDeposited()",
  "error DistributeWindow()",
  "error GaugeDoesNotExist(address gauge)",
  "error GaugeNotAlive(address gauge)",
  "error InactiveManagedNFT()",
  "error LockExpired()",
  "error NonZeroVotes()",
  "error NotApprovedOrOwner()",
  "error NotWhitelistedNFT()",
  "error NotWhitelistedToken()",
  "error SpecialVotingWindow()",
  "error TooManyGauges()",
  "error TooManyPools()",
  "error UnequalLengths()",
  "error ZeroAddress()",
  "error ZeroBalance()",
  "error ZeroLength()",
])

/** A bribe or fee reward contract, for claims and pool incentives. */
export const VOTING_REWARD_WRITE_ABI = parseAbi([
  "function earned(address token, uint256 tokenId) view returns (uint256)",
  "function rewardsListLength() view returns (uint256)",
  "function rewards(uint256 index) view returns (address)",
  "function notifyRewardAmount(address token, uint256 amount)",
  "error InvalidReward()",
  "error NotAuthorized()",
  "error NotWhitelisted()",
  "error ZeroAmount()",
])

/** veMEZO locks for up to 208 weeks (`maxLockTime = 208 * 7 * 86400`). */
export const VEMEZO_MAX_LOCK_SECONDS = 208 * 7 * 86_400

/**
 * veBTC locks for up to 28 days. Its `maxLockTime` is set at initialize and
 * has no getter; eth_call `createLock` on mainnet accepts durations whose
 * week-rounded end is at most 28 days out and reverts LockDurationTooLong
 * past that (probed 8 Nov 2026).
 */
export const VEBTC_MAX_LOCK_SECONDS = 28 * 86_400
