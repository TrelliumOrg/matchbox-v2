import { MorphText, useReducedMotion } from "@matchbox/motion"
import { type ReactNode, useEffect, useState } from "react"

/**
 * Example questions the Stuart strip cycles through, each at most five
 * words, from what Stuart really answers: the panel's own suggestions
 * (packages/stuart-ui, panel.tsx) and its protocol topics
 * (apps/stuart/src/query/tools/protocol.ts). The owner's line comes first.
 */
export const stuartQuestions = [
  "Ask about your locks.",
  "When do my locks unlock?",
  "Which gauges pay the most?",
  "How does boost work?",
  "Claim all my rewards.",
  "What are this epoch's incentives?",
] as const

/** Each question shows this long before the next morphs in. */
export const questionMs = 3500

/**
 * The next question every few seconds with the text morph, paused while
 * the strip is hovered or focused, and static under reduced motion.
 */
export function StuartQuestions({ paused }: { paused: boolean }): ReactNode {
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (paused || reduced) return
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % stuartQuestions.length),
      questionMs,
    )
    return () => clearInterval(timer)
  }, [paused, reduced])
  const question = stuartQuestions[reduced ? 0 : index] ?? stuartQuestions[0]
  return (
    <span aria-live="off" data-stuart-question="">
      <MorphText duration={300}>{question}</MorphText>
    </span>
  )
}
