import { describe, expect, it } from "vitest"
import { numberWords, withoutNumberWords } from "./numberWords"

describe("numbers written in words", () => {
  it("reads their value", () => {
    const read = (text: string) =>
      numberWords(text).map((each) => [each.text, each.value])
    expect(read("send five thousand MUSD")).toEqual([["five thousand", "5000"]])
    expect(read("a twenty-five percent APY")).toEqual([["twenty-five", "25"]])
    expect(read("one hundred and twenty BTC")).toEqual([
      ["one hundred and twenty", "120"],
    ])
    expect(read("a hundred BTC, two million MEZO")).toEqual([
      ["a hundred", "100"],
      ["two million", "2000000"],
    ])
    expect(read("Five thousand two hundred")).toEqual([
      ["Five thousand two hundred", "5200"],
    ])
  })

  it("skips one on its own and words that only contain a number", () => {
    expect(numberWords("Which one should get the vote? No one.")).toEqual([])
    expect(numberWords("someone often attends")).toEqual([])
    expect(numberWords("the only one of 723 targets")).toEqual([])
  })

  it("reads a run that is not one number word by word", () => {
    expect(numberWords("five six").map((each) => each.value)).toEqual([
      "5",
      "6",
    ])
    expect(numberWords("three and four").map((each) => each.value)).toEqual([
      "3",
      "4",
    ])
  })

  it("reads amount words: short scales, dozens, couples and vague amounts", () => {
    const read = (text: string) =>
      numberWords(text).map((each) => [each.text, each.value])
    expect(read("send five grand")).toEqual([["five grand", "5000"]])
    expect(read("send five k now")).toEqual([["five k", "5000"]])
    expect(read("five mil MEZO")).toEqual([["five mil", "5000000"]])
    expect(read("a dozen BTC")).toEqual([["a dozen", "12"]])
    expect(read("two dozen locks")).toEqual([["two dozen", "24"]])
    expect(read("a couple of BTC")).toEqual([["a couple of", "2"]])
    expect(read("thousands of MUSD")).toEqual([["thousands", "vague"]])
    expect(read("one BTC")).toEqual([["one", "1"]])
    expect(read("one veMEZO lock")).toEqual([["one", "1"]])
    expect(read("one dollar")).toEqual([["one", "1"]])
    // A short scale alone is another word.
    expect(read("a grand plan, Plan K, mil")).toEqual([])
    expect(read("one of them, which one")).toEqual([])
  })

  it("says where each number word starts", () => {
    expect(numberWords("pay five MUSD").map((each) => each.index)).toEqual([4])
    expect(numberWords("five six").map((each) => each.index)).toEqual([0, 5])
  })

  it("strips number words from a name", () => {
    expect(withoutNumberWords("Lavender.Five")).toBe("Lavender.")
    expect(withoutNumberWords("Five Thousand").trim()).toBe("")
  })
})
