/**
 * Test helpers for anything that animates under happy-dom.
 */

const patched = Symbol.for("matchbox.motion.cancelHandled")

type Patchable = Animation & { [patched]?: true }

/**
 * Makes happy-dom cancel an animation the way browsers do. The Web
 * Animations spec rejects a cancelled animation's `finished` promise and
 * marks it handled, so nothing is reported when nobody listens. happy-dom
 * rejects it unhandled: every animation cancelled mid-flight (torph does it
 * on each text change and on unmount) becomes an "unhandled error" that
 * fails the test file, and only when the machine is slow enough for the
 * animation to still be running. Call it once from a test setup file.
 */
export function handleCancelledAnimations(): void {
  if (typeof Animation === "undefined") return
  const prototype: Patchable = Animation.prototype
  if (prototype[patched] === true) return
  const cancel = prototype.cancel
  prototype.cancel = function cancelHandled(this: Animation): void {
    this.finished.catch(() => {})
    cancel.call(this)
  }
  prototype[patched] = true
}
