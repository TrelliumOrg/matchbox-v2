import { getAddress, parseAbi } from "viem"

// Safe{Wallet} on Mezo (safe.mezo.org, run by Den). The canonical Safe 1.4.1
// deployments, each checked for code on chain 31612 on 9 Nov 2026; the
// Transaction Service lists 1.4.1+L2 and 1.3.0+L2 singletons. Pro batches a
// plan through MultiSendCallOnly (DELEGATECALL from the Safe, so the Safe is
// msg.sender of every inner call) and simulates it with the Safe's own
// StorageAccessible.simulateAndRevert plus SimulateTxAccessor. These are
// Safe's contracts, not a forwarder: every proposal is a SafeTx the owners
// sign and the Safe executes.

export const SAFE_CONTRACTS = {
  mainnet: {
    safeL2Singleton: getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"),
    safeSingleton: getAddress("0x41675C099F32341bf84BFc5382aF534df5C7461a"),
    proxyFactory: getAddress("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"),
    multiSendCallOnly: getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"),
    simulateTxAccessor: getAddress(
      "0x3d4BA2E0884aa488718476ca2FB8Efc291A46199",
    ),
    fallbackHandler: getAddress("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"),
  },
} as const

/** The Safe (1.3.0 and 1.4.1) reads and writes Pro uses. */
export const SAFE_ABI = parseAbi([
  "function VERSION() view returns (string)",
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function isOwner(address owner) view returns (bool)",
  "function approvedHashes(address owner, bytes32 hash) view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
  "function simulateAndRevert(address targetContract, bytes calldataPayload)",
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
  "error GS013()",
])

/** Batches calls; only CALL entries (operation 0) are accepted. */
export const MULTI_SEND_CALL_ONLY_ABI = parseAbi([
  "function multiSend(bytes transactions) payable",
])

/** Run through simulateAndRevert (it only works as a DELEGATECALL). */
export const SIMULATE_TX_ACCESSOR_ABI = parseAbi([
  "function simulate(address to, uint256 value, bytes data, uint8 operation) returns (uint256 estimate, bool success, bytes returnData)",
])

export const SAFE_PROXY_FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
])
