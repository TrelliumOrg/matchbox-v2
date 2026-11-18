import { handleCancelledAnimations } from "@matchbox/motion/testing"

// happy-dom reports a cancelled animation as an unhandled error; browsers
// do not. Without this a slow machine fails files that render MorphText.
handleCancelledAnimations()
