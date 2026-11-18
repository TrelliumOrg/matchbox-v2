/**
 * What a host's first paint may import from Stuart: the dog mark, the ids
 * the Ctrl K bar and the panel share, and the store core. React and the
 * store only, so the bar costs almost nothing before intent. The corner
 * launcher is retired (matchbox-v3, Decided 9 Nov 2026): entry is the
 * host's Ctrl K bar, which loads the results sheet and the panel on intent.
 */

/** The bar's input: the panel returns focus here when it closes. */
export const barInputId = "stuart-bar-input"

/** The bar itself: the panel docks above its right end and grows from it. */
export const barId = "stuart-bar"

export { StuartBadge, StuartMark } from "./mark"
export {
  closeStuartSearch,
  getStuartState,
  openStuart,
  openStuartSearch,
  toggleStuart,
  useStuart,
  warmStuart,
} from "./store"
