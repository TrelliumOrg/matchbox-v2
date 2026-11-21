// Test-only: BIP-39 phrases generated from fixed seeds, so no real funded
// phrase is involved and nothing secret is committed. Imported by tests
// and the offline routing measurements, never by the Worker.

import { BIP39_INDEX } from "./bip39Words"
import { bip39Checksum, QUESTION_WORDS } from "./secretShapes"

const LIST = [...BIP39_INDEX.keys()]
const QUESTIONS = [...QUESTION_WORDS]
const OTHERS = LIST.filter((word) => !QUESTION_WORDS.has(word))

/** A small seeded generator (mulberry32): the same seed, the same words. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T
}

export type TestPhrase = {
  words: string[]
  /** Where the question words are. */
  questions: number[]
}

/**
 * A valid phrase of `length` words holding exactly `questions` question
 * words (QUESTION_WORDS) at seeded places, its last word chosen so the
 * checksum holds.
 */
export async function seededPhrase(
  length: number,
  questions: number,
  seed: number,
): Promise<TestPhrase> {
  const random = seeded(seed)
  const places = new Set<number>()
  while (places.size < questions) {
    places.add(Math.floor(random() * (length - 1)))
  }
  const head = Array.from({ length: length - 1 }, (_, index) =>
    places.has(index) ? pick(QUESTIONS, random) : pick(OTHERS, random),
  )
  const offset = Math.floor(random() * OTHERS.length)
  for (let step = 0; step < OTHERS.length; step += 1) {
    const last = OTHERS[(offset + step) % OTHERS.length] as string
    if (await bip39Checksum([...head, last])) {
      return { words: [...head, last], questions: [...places].sort() }
    }
  }
  throw new Error(`no checksum word for seed ${seed}`)
}

/**
 * The phrase with one word mistyped: one letter of a word that is not a
 * question word changed, so the word is no longer on the list.
 */
export function withTypo(phrase: TestPhrase, seed: number): string[] {
  const random = seeded(seed * 7 + 3)
  const places = phrase.words
    .map((_, index) => index)
    .filter((index) => !phrase.questions.includes(index))
  for (;;) {
    const place = pick(places, random)
    const word = phrase.words[place] as string
    const at = Math.floor(random() * word.length)
    const letter = pick([..."abcdefghijklmnopqrstuvwxyz"], random)
    const typo = `${word.slice(0, at)}${letter}${word.slice(at + 1)}`
    if (typo === word || BIP39_INDEX.has(typo)) continue
    const words = [...phrase.words]
    words[place] = typo
    return words
  }
}

/** The phrase BIP-39 makes of the given entropy (16 to 32 bytes). */
export async function phraseOfEntropy(entropy: Uint8Array): Promise<string[]> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", entropy))
  const bits: number[] = []
  for (const byte of entropy) {
    for (let bit = 7; bit >= 0; bit -= 1) bits.push((byte >> bit) & 1)
  }
  for (let bit = 0; bit < (entropy.length * 8) / 32; bit += 1) {
    bits.push(((hash[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1)
  }
  const words: string[] = []
  for (let at = 0; at < bits.length; at += 11) {
    const index = bits
      .slice(at, at + 11)
      .reduce((value, bit) => (value << 1) | bit, 0)
    words.push(LIST[index] as string)
  }
  return words
}

/** Deterministic entropy: all zero, all one, incrementing bytes. */
export function fixedEntropies(bytes: number): Uint8Array[] {
  return [
    new Uint8Array(bytes),
    new Uint8Array(bytes).fill(0xff),
    Uint8Array.from({ length: bytes }, (_, index) => index),
  ]
}
