import {
  getStuartState,
  openStuart,
  type StuartEntity,
  type StuartSigner,
  type StuartSurface,
  setStuartState,
} from "./store"

/**
 * Store actions the launcher does not need: the panel's own controls and
 * the entry points routes call. A separate module so bundlers keep it off
 * first paint (a module shared with the entry would land in the entry).
 */

let askId = 0

/** Collapses to the pill while there is something to show, else hides. */
export function minimizeStuart(): void {
  setStuartState({
    view: getStuartState().question === null ? "hidden" : "minimized",
  })
}

export function expandStuart(): void {
  openStuart("expanded")
}

export function dockStuart(): void {
  openStuart("docked")
}

/** Opens the panel and asks. Ctrl K's "Ask Stuart" row calls this. */
export function askStuart(
  question: string,
  entity?: StuartEntity,
  surface: StuartSurface = "palette",
): void {
  askId += 1
  setStuartState({
    ask: { id: askId, question, entity: entity ?? null, surface },
    view:
      getStuartState().view === "expanded"
        ? "expanded"
        : getStuartState().lastOpen,
    wanted: true,
  })
}

/** Opens the panel with an entity pinned as context, for its own question. */
export function askAboutThis(entity: StuartEntity): void {
  askId += 1
  setStuartState({
    ask: { id: askId, question: null, entity, surface: "canvas" },
    view:
      getStuartState().view === "expanded"
        ? "expanded"
        : getStuartState().lastOpen,
    wanted: true,
  })
}

/** The panel calls this once it has taken the pending question. */
export function takeStuartAsk(id: number): void {
  if (getStuartState().ask?.id === id) setStuartState({ ask: null })
}

/** The panel reports progress so the launcher and the pill can show it. */
export function setStuartActivity(activity: {
  answering: boolean
  status: string | null
  question: string | null
}): void {
  if (
    activity.answering === getStuartState().answering &&
    activity.status === getStuartState().status &&
    activity.question === getStuartState().question
  ) {
    return
  }
  setStuartState(activity)
}

/** Registers the host's signer. Returns the function that removes it. */
export function registerStuartSigner(signer: StuartSigner): () => void {
  setStuartState({ signer })
  return () => {
    if (getStuartState().signer === signer) setStuartState({ signer: null })
  }
}
