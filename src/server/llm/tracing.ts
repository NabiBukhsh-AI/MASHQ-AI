import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { learningSessions, llmCalls } from "../db/schema";
import { getRequestId } from "../obs/request-context";
import { log } from "../obs/logger";
import { recordSpend } from "../security/spend";
import type { Usage } from "./types";

export interface CallRecord {
  orgId: string;
  sessionId?: string;
  contentId?: string;
  task: string;
  promptVersion?: string;
  usage: Usage;
  status: "ok" | "error" | "timeout" | "retracted";
  errorCode?: string;
}

/**
 * One llm_calls row per call (no prompt or output text), the spend ledger, and
 * the session token counter. Langfuse export is added when keys exist.
 */
export async function recordCall(rec: CallRecord, db: Db = defaultDb): Promise<void> {
  const u = rec.usage;
  const tokens = u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  try {
    await db.insert(llmCalls).values({
      orgId: rec.orgId,
      sessionId: rec.sessionId,
      contentId: rec.contentId,
      task: rec.task,
      tier: u.tier,
      provider: u.provider,
      model: u.model,
      promptVersion: rec.promptVersion,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      costUsd: u.costUsd.toFixed(6),
      latencyMs: u.latencyMs,
      ttftMs: u.ttftMs,
      status: rec.status,
      fallback: u.fallback,
      errorCode: rec.errorCode,
      requestId: getRequestId(),
    });
    if (u.costUsd > 0 || tokens > 0)
      await recordSpend(rec.orgId, u.provider, u.costUsd, tokens, db);
    if (rec.sessionId) {
      await db
        .update(learningSessions)
        .set({
          tokensUsed: sql`${learningSessions.tokensUsed} + ${tokens}`,
          costUsd: sql`${learningSessions.costUsd} + ${u.costUsd.toFixed(5)}`,
        })
        .where(and(eq(learningSessions.id, rec.sessionId), eq(learningSessions.orgId, rec.orgId)));
    }
  } catch (e) {
    // Accounting must never break a learner turn.
    log.error({ event: "llm_call_record_failed", err: e, task: rec.task });
  }
  log.info({
    event: "llm_call",
    task: rec.task,
    tier: u.tier,
    provider: u.provider,
    status: rec.status,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    costUsd: u.costUsd,
    ttftMs: u.ttftMs,
    latencyMs: u.latencyMs,
    fallback: u.fallback,
    errorCode: rec.errorCode,
  });
}
