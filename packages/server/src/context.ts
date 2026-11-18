import type { ErrorCode } from "@matchbox/contracts/errors"
import type { Logger } from "@matchbox/logger"

declare module "hono" {
  // Declaration merging is the only way to type middleware-provided vars.
  interface ContextVariableMap {
    requestId: string
    logger: Logger
    /** Set by `errorResponse`; request logs record it. */
    errorCode: ErrorCode
  }
}
