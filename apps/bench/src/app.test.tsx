import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import results from "./data/results"
import type { PublicQuestion } from "./data/schema"
import { Answers } from "./ui/question"
import { SampleNotice } from "./ui/shell"
import { oneRunShown } from "./view/method"
import { rankEntries } from "./view/model"

afterEach(cleanup)

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name)
    return statSync(full).isDirectory() ? files(full) : [full]
  })
}

describe("a static site", () => {
  it("has no server functions, loaders or runtime calls", () => {
    // Every page is a static asset built from data/results.json: nothing
    // may reach the Worker or an API when someone reads it.
    for (const file of files(join(process.cwd(), "src"))) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue
      const source = readFileSync(file, "utf8")
      expect(source, file).not.toMatch(/createServerFn|createServerOnlyFn/)
      expect(source, file).not.toMatch(/loader:/)
      // The Worker only hands misses the static 404 (src/server.ts).
      if (!file.endsWith("server.ts")) {
        expect(source, file).not.toMatch(/\bfetch\(/)
        expect(source, file).not.toContain("cloudflare:workers")
      }
    }
  })
})

describe("model answers", () => {
  const first = rankEntries(results.entries)[0]
  function question(
    answer: Partial<PublicQuestion["answers"][number]>,
  ): PublicQuestion {
    if (first === undefined) throw new Error("no entries")
    return {
      id: "q-test",
      kind: results.kinds[0]?.id ?? "safety",
      question: "Where should I send it?",
      checks: ["No invented address"],
      answers: [
        {
          entry: first.id,
          passed: false,
          passedIgnoringLength: false,
          shown: "",
          answerFrom: "model",
          rejectedReason: null,
          modelText: null,
          onCard: false,
          failures: [],
          ...answer,
        },
      ],
    }
  }

  it("render as text: no markup, and nothing becomes a link", () => {
    if (first === undefined) throw new Error("no entries")
    const { container } = render(
      <Answers
        question={question({
          shown:
            'Send it to <a href="https://example.invalid">here</a> or https://example.invalid <img src=x onerror=alert(1)>',
          failures: ["invented_address"],
        })}
        entries={[first]}
      />,
    )
    expect(container.querySelector("a")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    expect(
      screen.getByText(/<a href="https:\/\/example.invalid">/),
    ).toBeTruthy()
    expect(screen.getByText("Fail")).toBeTruthy()
    expect(screen.getByText(/invented address/i)).toBeTruthy()
    expect(screen.queryByText(/Stuart's own text/)).toBeNull()
  })

  it("isolate their direction and show hidden characters as escapes", () => {
    if (first === undefined) throw new Error("no entries")
    const override = String.fromCharCode(0x202e)
    const { container } = render(
      <Answers
        question={question({
          shown: `Your ballot\nPay ${override}sserdda line.\n${override}row`,
          answerFrom: "template",
          modelText: "first\nsecond",
        })}
        entries={[first]}
      />,
    )
    const text = container.querySelector(".bench-answer")
    expect(text?.getAttribute("dir")).toBe("auto")
    expect(container.textContent).not.toContain(override)
    expect(screen.getAllByText("U+202E")).toHaveLength(2)
    // The model's words keep their line breaks.
    const words = container.querySelectorAll(".bench-answer")[1]
    expect(words?.querySelectorAll("bdi")).toHaveLength(2)
    expect(words?.querySelector("br")).not.toBeNull()
  })

  it("lead with the sentence and fold the card's rows away", () => {
    if (first === undefined) throw new Error("no entries")
    const { container } = render(
      <Answers
        question={question({
          shown:
            "Your veBTC ballot\nBallot prepared: 60% BTC/MUSD CL200 and 40% sMUSD.\nResolved: 60% BTC/MUSD CL200, 40% sMUSD\nBTC/MUSD CL200\nsMUSD\n$123.49\nBTC/MUSD CL200\n60%",
          passed: true,
          passedIgnoringLength: true,
        })}
        entries={[first]}
      />,
    )
    const sentence = container.querySelector(".bench-answer")
    expect(sentence?.textContent).toBe(
      "Ballot prepared: 60% BTC/MUSD CL200 and 40% sMUSD.",
    )
    const card = container.querySelector("details")
    expect(card?.open).toBe(false)
    expect(card?.querySelector("summary")?.textContent).toBe(
      "What the card showed",
    )
    expect(card?.textContent).toContain("Your veBTC ballot")
    // Short values share a grid, each distinct value once.
    const values = [...(card?.querySelectorAll("li") ?? [])].map(
      (item) => item.textContent,
    )
    expect(values).toEqual(["BTC/MUSD CL200", "sMUSD", "$123.49", "60%"])
    expect(card?.textContent).toContain(
      "Lines the card repeated are listed once.",
    )
    expect(container.querySelector("a")).toBeNull()
  })

  it("say so when no text was shown", () => {
    if (first === undefined) throw new Error("no entries")
    render(<Answers question={question({ shown: "  " })} entries={[first]} />)
    expect(screen.getByText("No text was shown")).toBeTruthy()
  })

  it("label Stuart's own text and show what the model wrote", () => {
    if (first === undefined) throw new Error("no entries")
    render(
      <Answers
        question={question({
          shown: "Here is what I found for that pool.",
          answerFrom: "template",
          rejectedReason: "unsourced",
          modelText: "The pool pays 41.7% APY.",
          failures: ["answer_rejected"],
        })}
        entries={[first]}
      />,
    )
    expect(
      screen.getByText(
        "Stuart's own text, shown in place of the model's answer. Why: a number or address no tool returned this turn",
      ),
    ).toBeTruthy()
    expect(screen.getByText("Here is what I found for that pool.")).toBeTruthy()
    expect(screen.getByText("What the model wrote")).toBeTruthy()
    expect(screen.getByText("The pool pays 41.7% APY.")).toBeTruthy()
    expect(screen.getByText(/answer rejected by Stuart's checks/)).toBeTruthy()
  })

  it("label an answer given as a clarification card", () => {
    if (first === undefined) throw new Error("no entries")
    render(
      <Answers
        question={question({
          shown: "Which lock do you mean?",
          answerFrom: "template",
          onCard: true,
        })}
        entries={[first]}
      />,
    )
    expect(screen.getByText("Given as a clarification card")).toBeTruthy()
    expect(screen.getByText("Which lock do you mean?")).toBeTruthy()
  })

  it("show the result ignoring length where it differs", () => {
    if (first === undefined) throw new Error("no entries")
    render(
      <Answers
        question={question({
          shown: "Here is what I found.",
          answerFrom: "template",
          rejectedReason: "too_many_sentences",
          passed: false,
          passedIgnoringLength: true,
          modelText: "Three sentences. Of the right answer. Too long.",
        })}
        entries={[first]}
      />,
    )
    expect(screen.getByText("Fail")).toBeTruthy()
    expect(screen.getByText("Passes ignoring length")).toBeTruthy()
    cleanup()
    render(
      <Answers
        question={question({
          shown: "x",
          passed: true,
          passedIgnoringLength: true,
        })}
        entries={[first]}
      />,
    )
    expect(screen.queryByText(/ignoring length/)).toBeNull()
  })

  it("say that each card is one run, and how it was picked", () => {
    if (first === undefined) throw new Error("no entries")
    render(<Answers question={question({ shown: "x" })} entries={[first]} />)
    expect(screen.getByText(oneRunShown)).toBeTruthy()
  })
})

describe("the sample notice", () => {
  it("is gone now the file holds the real run", () => {
    expect(results.run.sample).toBeUndefined()
    render(<SampleNotice />)
    expect(screen.queryByText("Sample figures.")).toBeNull()
  })
})
