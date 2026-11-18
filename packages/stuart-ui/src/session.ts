import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"
import { setStuartActivity } from "./actions"
import type { StuartTransport } from "./client"
import type { StuartRequest } from "./contract"
import type { AskOptions, PanelWallet } from "./host"
import {
  browserStorage,
  loadThread,
  type StorageLike,
  saveThread,
  walletKey,
} from "./persistence"
import type { StuartEntity, StuartSurface } from "./store"
import {
  activeConversation,
  type Conversation,
  emptyThread,
  previousAnswer,
  streamingTurn,
  type ThreadAction,
  type ThreadState,
  threadReducer,
} from "./thread"

/**
 * One conversation at a time per wallet: asking aborts the question in
 * flight, every stream event goes through the reducer, and the thread is
 * saved whenever a turn settles. Status lines feed the launcher and pill.
 */

export type SessionOptions = {
  transport: StuartTransport
  wallet: PanelWallet | null
  route: string
  storage?: StorageLike | null
  now?: () => string
  uuid?: () => string
}

export type AskInput = {
  question: string
  entity: StuartEntity | null
  surface: StuartSurface
} & AskOptions

export type Session = {
  state: ThreadState
  conversation: Conversation | null
  answering: boolean
  ask: (input: AskInput) => void
  retry: (turnId: string) => void
  stop: () => void
  newChat: () => void
  select: (conversationId: string) => void
}

function defaultUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`
}

type Holder = { key: string | null; thread: ThreadState }

type HolderAction =
  | { type: "switch"; key: string; state: ThreadState }
  | ThreadAction

/** The thread plus the wallet it belongs to, so a save never crosses wallets. */
function holderReducer(holder: Holder, action: HolderAction): Holder {
  if (action.type === "switch") return { key: action.key, thread: action.state }
  const thread = threadReducer(holder.thread, action)
  return thread === holder.thread ? holder : { ...holder, thread }
}

function defaultNow(): string {
  return new Date().toISOString()
}

export function useStuartSession({
  transport,
  wallet,
  route,
  storage = browserStorage(),
  now = defaultNow,
  uuid = defaultUuid,
}: SessionOptions): Session {
  const key = walletKey(wallet?.address ?? null)
  const [holder, dispatchHolder] = useReducer(holderReducer, {
    key: null,
    thread: emptyThread,
  })
  const state = holder.thread
  const dispatch = dispatchHolder
  const stateRef = useRef(state)
  stateRef.current = state
  const inflight = useRef<{
    turnId: string
    controller: AbortController
  } | null>(null)

  useEffect(() => {
    inflight.current?.controller.abort()
    inflight.current = null
    dispatchHolder({ type: "switch", key, state: loadThread(storage, key) })
  }, [storage, key])

  const settledSignature = useMemo(
    () =>
      `${state.conversations
        .flatMap((conversation) =>
          conversation.turns.map((turn) => `${turn.id}:${turn.outcome.kind}`),
        )
        .join("|")}#${state.activeId ?? ""}`,
    [state],
  )
  const holderKey = holder.key

  useEffect(() => {
    if (holderKey !== key || settledSignature === "#") return
    saveThread(storage, key, stateRef.current)
  }, [settledSignature, storage, key, holderKey])

  const current = streamingTurn(state)
  const conversation = activeConversation(state)

  useEffect(() => {
    setStuartActivity({
      answering: current !== null,
      status: current?.status.at(-1) ?? null,
      question:
        current?.question ?? conversation?.turns.at(-1)?.question ?? null,
    })
  }, [current, conversation])

  useEffect(
    () => () => {
      inflight.current?.controller.abort()
      setStuartActivity({ answering: false, status: null, question: null })
    },
    [],
  )

  const run = useCallback(
    (turnId: string, request: StuartRequest) => {
      inflight.current?.controller.abort()
      const controller = new AbortController()
      inflight.current = { turnId, controller }
      transport(request, controller.signal, (event) => {
        if (controller.signal.aborted) return
        dispatch({ type: "event", turnId, event, at: now() })
      })
        .then(() => {
          if (controller.signal.aborted) return
          dispatch({
            type: "fail",
            turnId,
            code: "internal",
            message: "No answer",
          })
        })
        .catch(() => {
          if (controller.signal.aborted) return
          dispatch({
            type: "fail",
            turnId,
            code: "network",
            message: "Offline",
          })
        })
        .finally(() => {
          if (inflight.current?.controller === controller)
            inflight.current = null
        })
    },
    [transport, now],
  )

  const requestFor = useCallback(
    (
      conversationId: string,
      turnIndex: number,
      turnId: string | null,
      input: AskInput,
    ): StuartRequest => {
      const thread =
        stateRef.current.conversations.find(
          (item) => item.id === conversationId,
        ) ?? null
      const previous = previousAnswer(thread, turnId)
      return {
        version: 1,
        query: (input.query ?? input.question).slice(0, 2_000),
        sessionId: conversationId,
        turn: Math.min(turnIndex, 200),
        surface: input.surface,
        chainId: 31_612,
        ...(wallet === null
          ? {}
          : {
              wallet: {
                address: wallet.address,
                mode: wallet.mode,
                ...(wallet.label === undefined ? {} : { label: wallet.label }),
              },
            }),
        context: {
          page: {
            route: route.slice(0, 120),
            ...(input.entity === null ? {} : { entity: input.entity }),
          },
          ...(previous === null
            ? {}
            : {
                previous: {
                  responseId: previous.responseId,
                  intent: previous.intent,
                },
              }),
          ...(input.clarification === undefined
            ? {}
            : { clarification: input.clarification }),
        },
      }
    },
    [wallet, route],
  )

  const ask = useCallback(
    (input: AskInput) => {
      const question = input.question.trim()
      if (question === "") return
      const active = activeConversation(stateRef.current)
      const conversationId = active?.id ?? uuid()
      const turnId = uuid()
      const turnIndex = active?.turns.length ?? 0
      const request = requestFor(conversationId, turnIndex, null, {
        ...input,
        question,
      })
      dispatch({
        type: "ask",
        conversationId,
        turnId,
        question,
        entity: input.entity,
        at: now(),
      })
      run(turnId, request)
    },
    [requestFor, run, now, uuid],
  )

  const retry = useCallback(
    (turnId: string) => {
      for (const item of stateRef.current.conversations) {
        const index = item.turns.findIndex((turn) => turn.id === turnId)
        const turn = item.turns[index]
        if (turn === undefined) continue
        const request = requestFor(item.id, index, turnId, {
          question: turn.question,
          entity: turn.entity,
          surface: "composer",
        })
        dispatch({ type: "retry", turnId, at: now() })
        run(turnId, request)
        return
      }
    },
    [requestFor, run, now],
  )

  const stop = useCallback(() => {
    const flight = inflight.current
    if (flight === null) return
    flight.controller.abort()
    inflight.current = null
    dispatch({ type: "stop", turnId: flight.turnId })
  }, [])

  const newChat = useCallback(() => {
    stop()
    dispatch({ type: "new" })
  }, [stop])

  const select = useCallback(
    (conversationId: string) => {
      stop()
      dispatch({ type: "select", conversationId })
    },
    [stop],
  )

  return {
    state,
    conversation,
    answering: current !== null,
    ask,
    retry,
    stop,
    newChat,
    select,
  }
}
