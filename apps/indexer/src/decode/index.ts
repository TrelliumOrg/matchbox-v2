// Decoder entry points. The cron Worker calls runProjection after ingest;
// scripts/project.ts replays from scratch. See docs/goldsky-exit.md.

export {
  lockKeysForLog,
  resolveHandler,
  staticSourcesFor,
  troveKeysForLog,
} from "./dispatch"
export {
  builtDecoderVersion,
  DECODER_VERSION,
  ProjectionReplayRequiredError,
  type ProjectionResult,
  type ProjectionStatus,
  projectBlock,
  projectionStatus,
  resetProjection,
  runProjection,
} from "./projection"
export {
  ACTIVITY_FIELDS,
  type ActivityEventRow,
  type RewardDepositRow,
  type TroveUpdateRow,
} from "./rows"
export { InMemoryStore, type Store, WarehouseOnlyStore } from "./store"
