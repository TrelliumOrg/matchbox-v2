import * as FilterTabs from "@matchbox/ui/filter-tabs"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react"
import results from "../data/results"
import {
  defaultSelection,
  type EffortView,
  effortName,
  effortShape,
  effortsOf,
  modelsOf,
  type RankBy,
  rankOrder,
  type Selection,
  scoreLine,
  scoreName,
  toggleModel,
} from "../view/model"
import { Marker, Swatch } from "./marker"

/**
 * The reader's choices: which models show anywhere on the page, and which
 * entries the grid, the cards and the question show. Starts with every
 * model and each model's best entry, which is also what the prerendered
 * HTML shows, so hydration never changes the page.
 */

type SelectionState = {
  selection: Selection
  setSelection: (next: Selection) => void
}

const SelectionContext = createContext<SelectionState>({
  selection: defaultSelection,
  setSelection: () => {},
})

export function SelectionProvider({
  children,
}: {
  children: ReactNode
}): ReactNode {
  const [selection, setSelection] = useState<Selection>(defaultSelection)
  const value = useMemo(() => ({ selection, setSelection }), [selection])
  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  )
}

export function useSelection(): SelectionState {
  return useContext(SelectionContext)
}

export const models = modelsOf(results.entries)
export const efforts = effortsOf(results.entries)

const pill =
  "flex h-9 cursor-pointer items-center gap-2 rounded-[18px] px-3.5 max-md:h-10 text-[14.5px] font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

/** Show or hide each model, everywhere on the page. */
export function ModelFilter(): ReactNode {
  const { selection, setSelection } = useSelection()
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Models shown</legend>
      <div className="flex flex-wrap gap-1 rounded-[22px] bg-soft p-1">
        {models.map((item) => {
          const shown = !selection.hidden.has(item.model)
          const last = shown && models.length - selection.hidden.size === 1
          return (
            <button
              key={item.model}
              type="button"
              aria-pressed={shown}
              disabled={last}
              title={last ? "At least one model stays shown" : undefined}
              onClick={() => setSelection(toggleModel(selection, item.model))}
              className={`${pill} ${shown ? "bg-bg font-semibold text-ink" : "text-sec line-through decoration-1"} disabled:cursor-default`}
            >
              <Swatch colour={shown ? item.colour : "var(--mut)"} />
              {item.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

const budget = results.run.limits.stuartBudgetMs

/** The three scores' names: "Inside Stuart", "Ignoring length", "Within 20 s". */
export const scoreLabels: Record<RankBy, string> = {
  score: scoreName("score", budget),
  "ignoring-length": scoreName("ignoring-length", budget),
  "within-stuart": scoreName("within-stuart", budget),
}

/** Each score in one plain line. */
export const scoreLines: Record<RankBy, string> = {
  score: scoreLine("score", budget),
  "ignoring-length": scoreLine("ignoring-length", budget),
  "within-stuart": scoreLine("within-stuart", budget),
}

/** "Within 20 s": the production limit, from the run. */
export const withinLabel = scoreLabels["within-stuart"]

/** "within 20 s", for the middle of a sentence. */
export const withinPhrase = `w${withinLabel.slice(1)}`

/** Which score ranks the leaderboard (and picks each model's best). */
export function RankPicker(): ReactNode {
  const { selection, setSelection } = useSelection()
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <span aria-hidden="true" className="text-[14px] text-sec">
        Rank by
      </span>
      <SegmentedControl.Root
        aria-label="Rank by"
        size="md"
        className="max-md:h-12"
        value={selection.rankBy}
        onValueChange={(value) => {
          const rankBy = rankOrder.find((item) => item === value)
          if (rankBy !== undefined) setSelection({ ...selection, rankBy })
        }}
      >
        {rankOrder.map((item) => (
          <SegmentedControl.Item key={item} value={item}>
            {scoreLabels[item]}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
    </div>
  )
}

/** An effort view as the string FilterTabs carries, and back. */
function viewKey(view: EffortView): string {
  return typeof view === "string" ? view : `effort:${view.effort}`
}

const views: { view: EffortView; label: string }[] = [
  { view: "best", label: "Best of each model" },
  ...efforts.map((effort) => ({ view: { effort }, label: effortName(effort) })),
  { view: "all", label: "All" },
]

/** Which entries the grid, the cards and the question show. */
export function EffortPicker(): ReactNode {
  const { selection, setSelection } = useSelection()
  return (
    <FilterTabs.Root
      label="Entries shown in the grid and cards"
      className="max-md:[&_button]:h-10"
      value={viewKey(selection.effortView)}
      onValueChange={(key) => {
        const item = views.find((each) => viewKey(each.view) === key)
        if (item !== undefined)
          setSelection({ ...selection, effortView: item.view })
      }}
    >
      {views.map((item) => (
        <FilterTabs.Item key={item.label} value={viewKey(item.view)}>
          {typeof item.view === "string" ? null : (
            <Marker
              shape={effortShape(item.view.effort)}
              colour="currentColor"
              size={12}
            />
          )}
          {item.label}
        </FilterTabs.Item>
      ))}
    </FilterTabs.Root>
  )
}
