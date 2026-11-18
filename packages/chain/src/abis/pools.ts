// Mezo pools. Event fragments from the indexer's decode ABIs.

export const POOL_FACTORY_EVENTS_ABI = [
  {
    type: "event",
    name: "PoolCreated",
    anonymous: false,
    inputs: [
      {
        name: "token0",
        type: "address",
        indexed: true,
      },
      {
        name: "token1",
        type: "address",
        indexed: true,
      },
      {
        name: "stable",
        type: "bool",
        indexed: true,
      },
      {
        name: "pool",
        type: "address",
        indexed: false,
      },
      {
        name: "arg4",
        type: "uint256",
        indexed: false,
      },
    ],
  },
] as const

export const POOL_EVENTS_ABI = [
  {
    type: "event",
    name: "Mint",
    anonymous: false,
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "Burn",
    anonymous: false,
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
      },
      {
        name: "to",
        type: "address",
        indexed: true,
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
      },
    ],
  },
  {
    type: "event",
    name: "Swap",
    anonymous: false,
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
      },
      {
        name: "to",
        type: "address",
        indexed: true,
      },
      {
        name: "amount0In",
        type: "uint256",
        indexed: false,
      },
      {
        name: "amount1In",
        type: "uint256",
        indexed: false,
      },
      {
        name: "amount0Out",
        type: "uint256",
        indexed: false,
      },
      {
        name: "amount1Out",
        type: "uint256",
        indexed: false,
      },
    ],
  },
] as const
