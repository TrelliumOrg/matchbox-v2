import {
  demoReadModels,
  demoWallet,
} from "@matchbox/contracts/read-models/fixtures"
import * as adapt from "../data/adapters"
import { fixtureEpochReference } from "../data/fixture-api"

/**
 * Sample data that Skullet measures into skeletons for pending routes, so a
 * skeleton takes the exact final shape (CLS 0): the shared demo read models
 * through the same adapters as live data. Only the lazily loaded pending
 * screens import this.
 */

const reference = fixtureEpochReference

export const overviewSample = adapt.overview(
  demoReadModels.overview,
  reference,
  47,
)
export const rewardsSample = adapt.rewards(demoReadModels.rewards)
export const activitySample = adapt.activityPage(
  demoReadModels.activity,
  reference,
)
export const protocolSample = adapt.protocol(demoReadModels.protocol)
export const gaugesSample = adapt.gaugeList(demoReadModels.gauges)
export const voterSample = adapt.voter(demoReadModels.overview)
export const gaugeSample = adapt.gaugeProfile(demoReadModels.gaugeProfile)
export const sampleWallet = demoWallet
