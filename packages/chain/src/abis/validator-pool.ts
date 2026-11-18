export const VALIDATOR_POOL_ABI = [
  {
    inputs: [],
    name: "validators",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "operator", type: "address" }],
    name: "validator",
    outputs: [
      { internalType: "bytes32", name: "consPubKey", type: "bytes32" },
      {
        components: [
          { internalType: "string", name: "moniker", type: "string" },
          { internalType: "string", name: "identity", type: "string" },
          { internalType: "string", name: "website", type: "string" },
          {
            internalType: "string",
            name: "securityContact",
            type: "string",
          },
          { internalType: "string", name: "details", type: "string" },
        ],
        internalType: "struct IValidatorPool.Description",
        name: "description",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const
