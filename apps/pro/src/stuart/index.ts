/**
 * Stuart for Pro routes: open the panel, ask, pin an entity ("Ask about
 * this"), register the signer, and on phones the top bar's search icon. No
 * provider is needed, and this module is tiny (the store, its types and a
 * 40px button), so any route can import it without growing first paint.
 * The panel and the search sheet load on first intent.
 *
 *   askStuart("which gauge pays best for 2207")        // ask from anywhere
 *   askAboutThis({ type: "gauge", id, label: name })    // gauge profile
 *   <StuartSearchButton />                              // phone top bar
 */

export {
  askAboutThis,
  askStuart,
  closeStuart,
  getStuartState,
  openStuart,
  registerStuartSigner,
  type StuartEntity,
  type StuartEntityType,
  type StuartSigner,
  type StuartSignOutcome,
  type StuartSignRequest,
  type StuartSignResult,
  type StuartState,
  type StuartView,
  useStuart,
  warmStuart,
} from "@matchbox/stuart-ui/store"
export { StuartSearchButton } from "./search-button"
