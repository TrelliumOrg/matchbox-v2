import { createFileRoute, Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import results from "../data/results"
import { pageHead } from "../data/site"
import { scoreLabels, withinLabel } from "../ui/selection"
import { PageHead } from "../ui/shell"
import {
  benchmarkLimits,
  costNote,
  dataSources,
  methodNotes,
  oneRunShown,
  runRules,
  stuartLimits,
  unitsNote,
} from "../view/method"
import { activeKinds, tokens, wholeSeconds } from "../view/model"

/**
 * How the benchmark works, from apps/stuart's README (Benchmark) and the
 * notes on the front page, and what it does not measure.
 */

export const Route = createFileRoute("/method")({
  head: () => pageHead("/method", "Method, Matchbench"),
  component: Method,
})

function Part({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}): ReactNode {
  return (
    <section aria-labelledby={id} className="mt-12 max-w-[700px]">
      <h2
        id={id}
        className="text-[24px] font-[650] tracking-[-0.015em] text-ink"
      >
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[16.5px] leading-[1.6] text-ink2 [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  )
}

function Method(): ReactNode {
  const { run } = results
  return (
    <>
      <PageHead
        title="Method"
        lede="Matchbench asks how well a model answers inside Stuart, not how well it chats. Every entry gets the same harness, the same fixed data and the same code that grades it. The questions are written for the benchmark, not taken from users."
      />
      <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {methodNotes(run).map((note) => (
          <li key={note.title} className="border-t-2 border-ink pt-3.5">
            <h3 className="text-[16.5px] font-[650] text-ink">{note.title}</h3>
            <p className="mt-1.5 text-[14.5px] leading-[1.45] text-sec">
              {note.body}
            </p>
          </li>
        ))}
      </ul>

      <Part id="harness" title="The harness">
        <p>
          Stuart is Matchbox's assistant for the Mezo network. Each entry runs
          Stuart's real orchestrator with its tools and its prompt. Only the
          model and its reasoning effort change from one entry to the next.
          Stuart normally answers common questions from templates and leaves the
          rest to the model. Here that router is off, so every question reaches
          the model.
        </p>
        <ul>
          {runRules(run).map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </Part>

      <Part id="scores" title="Three scores">
        <p>
          In the benchmark each answer gets up to {benchmarkLimits(run)}.
          Production Stuart allows {stuartLimits(run)}. The generous limits mean
          the highest effort levels show what a model can do when it is given
          the time. The leaderboard ranks by any of three scores, each the share
          of questions that passed, averaged over the entry's runs:
        </p>
        <ul>
          <li>
            <strong className="font-semibold text-ink">
              {scoreLabels.score}
            </strong>
            : the answer as a user would see it. The model's sentence had to
            pass Stuart's display rules (below), and the answer had to pass
            every check.
          </li>
          <li>
            <strong className="font-semibold text-ink">
              {scoreLabels["ignoring-length"]}
            </strong>
            : the same grading, except that a sentence Stuart refused only for
            its length (more than two sentences or over 280 characters, three
            and 400 for Mezo support) is graded on its content as if Stuart had
            shown it. Only the length limits are set aside: the sentence must
            still pass Stuart's other checks (no greeting, no claim to have
            acted, every number and address from that turn's tools) and every
            benchmark check, safety checks included. It is worked out from the
            stored answers, without asking any model again.
          </li>
          <li>
            <strong className="font-semibold text-ink">{withinLabel}</strong>:{" "}
            {scoreLabels.score}, and an answer also fails when it took longer
            than {wholeSeconds(run.limits.stuartBudgetMs)} or one request wrote
            more than {tokens(run.limits.stuartMaxTokens)}, as in production.
            That score shows what users would get.
          </li>
        </ul>
        <p>
          Only {scoreLabels.score} is published for each run. Its spread, the
          gap between an entry's best and worst run, is the measure of noise for
          all three: where two entries differ by less than either one's spread,
          the page treats them as level.
        </p>
      </Part>

      <Part id="not-shown" title="Answers Stuart did not show">
        <p>
          Stuart checks the model's answer sentence before a user sees it. It
          shows the sentence only when all of these hold:
        </p>
        <ul>
          <li>
            it is at most two sentences and 280 characters (three sentences and
            400 characters for Mezo support answers)
          </li>
          <li>
            every number and address in it comes from that turn's tool results
          </li>
          <li>
            it does not claim to have acted, and does not open with a greeting
          </li>
        </ul>
        <p>
          Otherwise the user sees Stuart's own template instead, and the
          benchmark counts the answer as failed. For some models this is a large
          share of their answers: the leaderboard's "Answers Stuart did not
          show" card gives it for each entry, split by reason. So the score
          measures how well a model works within Stuart's rules, not only
          whether it knew the answer.
        </p>
        <p>
          Numbers the user typed are not accepted either, by design. If they
          were, a scam message pasted into the chat could be repeated back in
          Stuart's voice, with its amount or address looking confirmed.
        </p>
        <p>
          The published questions mark every answer where the user saw Stuart's
          own text (a template, a card or its out of scope line) and show what
          the model wrote beside it.
        </p>
      </Part>

      <Part id="data" title="Fixed data">
        <p>
          The questions are written for the benchmark. Stuart answers them from
          fixed data, so the right answer never moves between runs or between
          models. Some of that data is captured from Mezo mainnet and some is
          test data:
        </p>
        <ul>
          <li>{dataSources.mainnet}</li>
          <li>{dataSources.testWallet}</li>
        </ul>
        <p>{dataSources.byKind}</p>
        <p>
          The expected numbers for the follow the money questions come from an
          independent investigation of the same window, not from the snapshot or
          from Stuart's own code.
        </p>
      </Part>

      <Part id="grading" title="Graded by code">
        <p>
          Every check is code. No model grades another. A question passes when
          every one of its checks passes:
        </p>
        <ul>
          <li>the intent Stuart recognised, and the tools it called</li>
          <li>
            what the user is shown, and every number in it, within a tolerance
          </li>
          <li>
            the exact ballot of a prepared vote, and that a prepared vote or
            claim is left unsigned for the user
          </li>
          <li>
            no invented address: vote targets are decoded from the call data and
            must be real pools or validators
          </li>
          <li>
            that general questions are left to the model, and the copy rules
          </li>
        </ul>
        <p>
          Some failures are about safety: ones a user could lose funds or trust
          over (
          {results.failureTypes
            .filter((type) => type.safety)
            .map((type) =>
              type.label
                .toLowerCase()
                .replace(
                  /\b(stuart|mezo)\b/g,
                  (name) => name.charAt(0).toUpperCase() + name.slice(1),
                ),
            )
            .join(", ")}
          ). The leaderboard counts them on their own.
        </p>
        <p>{unitsNote}</p>
      </Part>

      <Part id="runs" title="Runs and scores">
        <p>
          Each entry answers all {run.questions} questions once per run, up to{" "}
          {run.runsPerEntry} {run.runsPerEntry === 1 ? "run" : "runs"}. An entry
          still being run says how many it has finished, and its figures are
          over those runs only. The score is the share of questions that passed
          every check, averaged over the entry's runs. Agreement between runs
          shows how many questions an entry got right every time, only
          sometimes, or never. Time is from the question to the full answer,
          tools included, and a timed out answer counts at the time it took.
        </p>
        <p>{costNote}</p>
        <p>
          {run.publicQuestions} questions are published with every entry's
          answer from one of its runs (
          <Link
            to="/questions"
            className="font-semibold text-ink underline decoration-mut underline-offset-4 hover:decoration-ink"
          >
            Questions
          </Link>
          ). The other {run.questions - run.publicQuestions} stay private, so no
          model can be tuned to the test. {oneRunShown} The answer text and,
          where Stuart showed its own text, what the model wrote are the model's
          words from that one run.
        </p>
      </Part>

      <Part id="limits" title="Limits of this benchmark">
        <ul>
          <li>
            Claude models only. Stuart runs on Claude, so those are the models
            it can compare. A model from another provider would need its own
            harness, and the result would not be the same test.
          </li>
          <li>
            One harness. The scores say how a model does with Stuart's tools and
            prompt, not how it does anywhere else.
          </li>
          <li>
            Scores depend heavily on Stuart's own display rules. A large share
            of answers fail {scoreLabels.score} because Stuart did not show the
            sentence, which is why {scoreLabels["ignoring-length"]} is shown
            beside it.
          </li>
          <li>
            Some rejected answers contained only figures the model had been
            shown, for example in the user's message or an earlier turn, which
            Stuart's rules still refuse.
          </li>
          <li>
            The questions and their checks are written by the Matchbox team.
          </li>
          <li>
            {run.runsPerEntry === 1
              ? "One run per entry, so small differences may be noise."
              : `${run.runsPerEntry} runs per entry, so small differences are noise: the page treats entries as level when they differ by less than their own runs vary.`}
          </li>
          <li>
            Answers are graded by code, so style is not judged: a clear answer
            and a clumsy one that both carry the right facts score the same.
          </li>
          <li>
            Mezo questions only. The set covers{" "}
            {activeKinds(results.kinds)
              .map((kind) =>
                kind.label.startsWith("Mezo")
                  ? kind.label
                  : kind.label.charAt(0).toLowerCase() + kind.label.slice(1),
              )
              .join(", ")}
            , all on Mezo, and nothing else.
          </li>
        </ul>
      </Part>
    </>
  )
}
