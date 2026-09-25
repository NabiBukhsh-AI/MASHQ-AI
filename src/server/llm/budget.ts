import { and, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { learningSessions } from "../db/schema";
import type { Config } from "../config/schema";
import { checkSpend } from "../security/spend";
import { LlmError } from "./errors";

/**
 * Before any call: the org's daily spend state and the session token budget.
 * "degrade" is returned so the caller can pick cheaper behaviour; "block" throws.
 */
export async function assertBudget(
  config: Config,
  orgId: string,
  sessionId: string | undefined,
  db: Db = defaultDb,
): Promise<"ok" | "degrade"> {
  const state = await checkSpend(orgId, config.limits, db);
  if (state === "block") {
    throw new LlmError(
      "spend_blocked",
      "Today's spending cap for this organization is reached. Try again tomorrow or raise the cap.",
    );
  }
  if (sessionId) {
    const [row] = await db
      .select({ tokensUsed: learningSessions.tokensUsed })
      .from(learningSessions)
      .where(and(eq(learningSessions.id, sessionId), eq(learningSessions.orgId, orgId)))
      .limit(1);
    if (row && row.tokensUsed >= config.limits.tokenBudgetPerSession) {
      throw new LlmError(
        "budget_exceeded",
        "This session has used its token budget. Start a new session to continue.",
      );
    }
  }
  return state;
}
