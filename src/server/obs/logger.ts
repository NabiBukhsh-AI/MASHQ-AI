import pino from "pino";
import { env } from "@/env";
import { requestContext } from "./request-context";

// JSON logs only. Request ids come from AsyncLocalStorage, so call sites never
// pass them. Never log request bodies, transcripts or keys: pass named fields.
export const log = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  base: { service: "mashq", env: env.APP_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  mixin() {
    const ctx = requestContext.getStore();
    return ctx ? { requestId: ctx.requestId, userId: ctx.userId, role: ctx.role } : {};
  },
  redact: {
    paths: [
      "authorization",
      "cookie",
      "headers.authorization",
      "headers.cookie",
      "headers['x-health-token']",
      "*.password",
      "*.apiKey",
      "*.token",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof log;
