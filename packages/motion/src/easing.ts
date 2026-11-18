/** Motion curves and timings from the guideline's Build notes. */

export const easing = {
  /** Rolls and slides: digits, the price slot, sheets, sliding pills. */
  roll: "cubic-bezier(.2,.8,.2,1)",
  /** Text that changes in place. */
  text: "cubic-bezier(.19,1,.22,1)",
} as const

export const duration = {
  /** Digit rolls, slides and text morphs. */
  roll: 380,
  /** Lock card Manage flip. */
  flip: 360,
  /** The block number holds ink after a block lands. */
  inkHold: 450,
  /** Stagger between digits on a carry. */
  stagger: 30,
  /** Price slot cycle. */
  cycle: 4000,
  /** Average Mezo block time; the block ring fills over it. */
  block: 3800,
  /** Ceiling for any UI transition (charts may take up to 600ms). */
  max: 400,
} as const

/*
 * Enter and exit timings: separate constants, so first-paint code that
 * only needs `duration` does not carry them.
 */

/** Exits: list items. Quicker than entries. */
export const exitMs = 160

/** Sheets and drawers sliding out; a host keeps them mounted this long. */
export const sheetExitMs = 280

/** A list item, card, toast exit or content after a skeleton fading in. */
export const enterMs = 240
