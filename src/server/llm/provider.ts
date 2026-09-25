import type { z } from "zod";
import type { Config, Lang } from "../config/schema";
import { getOrgConfig } from "../config/service";
import { db as defaultDb, type Db } from "../db/client";
import { log } from "../obs/logger";
import { createRedactor } from "../security/redact";
import { anthropicAdapter } from "./anthropic";
import { assertBudget } from "./budget";
import { LlmError } from "./errors";
import { googleAdapter } from "./google";
import { costUsd } from "./pricing";
import { fallbackFor, resolveRoute, type ResolvedRoute } from "./routes";
import { recordFailure, recordSuccess, shouldAttempt } from "./breaker";
import { recordCall } from "./tracing";
import type {
  Adapter,
  AdapterRequest,
  EngineRequest,
  ObjectResult,
  RawUsage,
  StreamHandle,
  Usage,
} from "./types";

export type { EngineRequest, ObjectResult, StreamHandle, Usage } from "./types";
export { LlmError } from "./errors";

// The only door to any model. Routing, redaction, budgets, cache breakpoints,
// retries, fallback and accounting live here; feature code passes task names.

export interface LlmDeps {
  adapters: Record<"anthropic" | "google", Adapter>;
  db: Db;
  loadConfig: (orgId: string) => Promise<{ config: Config; version: number }>;
  now: () => number;
}

export interface CallOptions {
  signal?: AbortSignal;
  promptVersion?: string;
}

const defaultDeps: LlmDeps = {
  adapters: { anthropic: anthropicAdapter, google: googleAdapter },
  db: defaultDb,
  loadConfig: (orgId) => getOrgConfig(orgId),
  now: () => performance.now(),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createLlm(deps: LlmDeps = defaultDeps) {
  async function prepare(task: string, req: EngineRequest, opts: CallOptions) {
    const { config } = await deps.loadConfig(req.orgId);
    const route = resolveRoute(config, task, req.lang);
    const budget = await assertBudget(config, req.orgId, req.sessionId, deps.db);

    // Every text block is redacted with one redactor, so numbering is coherent.
    const redactor = createRedactor();
    const redacted = {
      system: redactor.redact(req.system).text,
      packBlocks: req.packBlocks.map((b) => redactor.redact(b).text),
      history: req.history.map((h) => ({ role: h.role, text: redactor.redact(h.text).text })),
      final: redactor.redact(req.final).text,
    };

    const controller = new AbortController();
    opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });

    const adapterRequest = (r: ResolvedRoute): AdapterRequest => ({
      model: r.model,
      ...redacted,
      maxOutputTokens: req.maxOutputTokens ?? r.route.maxOutputTokens,
      temperature: r.route.temperature,
      timeoutMs: r.route.timeoutMs,
      firstTokenTimeoutMs: r.route.firstTokenTimeoutMs,
      cacheTtl: config.llm.cacheTtl,
      signal: controller.signal,
    });

    return { config, route, budget, controller, adapterRequest };
  }

  function toUsage(
    config: Config,
    r: ResolvedRoute,
    raw: RawUsage,
    ttftMs: number,
    latencyMs: number,
    fallback: boolean,
  ): Usage {
    return {
      tier: r.tier,
      provider: r.provider,
      model: r.model,
      ...raw,
      costUsd: costUsd(config.llm.pricing, r.model, raw),
      ttftMs: Math.round(ttftMs),
      latencyMs: Math.round(latencyMs),
      fallback,
    };
  }

  /**
   * Try the primary route with retries before the first token, then the
   * fallback tier once. `attempt` must fail before yielding anything for a
   * retry to be safe.
   */
  async function withRetriesAndFallback<T>(
    config: Config,
    primary: ResolvedRoute,
    attempt: (r: ResolvedRoute) => Promise<T>,
    onFailure: (r: ResolvedRoute, e: LlmError, fallback: boolean) => Promise<void>,
  ): Promise<{ value: T; route: ResolvedRoute; fallback: boolean }> {
    const fallback = fallbackFor(config, primary);
    const primaryKey = `${primary.provider}:${primary.model}`;
    // A route the breaker has opened is skipped rather than retried, so a dead provider
    // costs one timeout for the whole open interval instead of one per request.
    const primaryAllowed = shouldAttempt(primaryKey, config.llm.breaker);
    const plan: { route: ResolvedRoute; fallback: boolean }[] = [];
    if (config.llm.fallback.force && fallback) {
      plan.push({ route: fallback, fallback: true });
    } else {
      if (primaryAllowed) plan.push({ route: primary, fallback: false });
      if (fallback) plan.push({ route: fallback, fallback: true });
      // With no secondary configured the primary is still tried: refusing to call it at
      // all would turn a degraded provider into a total outage.
      if (plan.length === 0) plan.push({ route: primary, fallback: false });
    }

    let lastError: LlmError | undefined;
    for (const step of plan) {
      for (let i = 0; i <= config.llm.retries.max; i++) {
        try {
          const value = await attempt(step.route);
          if (!step.fallback) recordSuccess(primaryKey);
          return { value, ...step };
        } catch (e) {
          const err =
            e instanceof LlmError ? e : new LlmError("provider_error", String(e), false, e);
          lastError = err;
          // Only infrastructure failures say anything about provider health. An abort is
          // the caller leaving, and a refusal or an unparseable answer is the model doing
          // its job, so neither opens the breaker.
          if (!step.fallback && err.retryable) {
            recordFailure(primaryKey, config.llm.breaker);
          }
          await onFailure(step.route, err, step.fallback);
          if (err.code === "aborted" || err.code === "refusal" || err.code === "invalid_output")
            throw err;
          if (!err.retryable) break;
          if (i < config.llm.retries.max) await sleep(config.llm.retries.baseMs * 2 ** i);
        }
      }
      if (config.llm.fallback.force) break;
    }
    throw lastError ?? new LlmError("provider_error", "No provider attempt was made.");
  }

  async function stream(
    task: string,
    req: EngineRequest,
    opts: CallOptions = {},
  ): Promise<StreamHandle> {
    const { config, route, controller, adapterRequest } = await prepare(task, req, opts);
    const started = deps.now();

    const failed = async (r: ResolvedRoute, e: LlmError, fallback: boolean) => {
      await recordCall(
        {
          orgId: req.orgId,
          sessionId: req.sessionId,
          contentId: req.contentId,
          task,
          promptVersion: opts.promptVersion,
          usage: toUsage(
            config,
            r,
            { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            0,
            deps.now() - started,
            fallback,
          ),
          status: e.code === "timeout" || e.code === "first_token_timeout" ? "timeout" : "error",
          errorCode: e.code,
        },
        deps.db,
      );
    };

    const {
      value: handle,
      route: used,
      fallback,
    } = await withRetriesAndFallback(
      config,
      route,
      (r) => deps.adapters[r.provider].stream(adapterRequest(r)),
      failed,
    );
    const ttftMs = deps.now() - started;

    const usage = handle.usage.then(
      async (raw) => {
        const u = toUsage(config, used, raw, ttftMs, deps.now() - started, fallback);
        await recordCall(
          {
            orgId: req.orgId,
            sessionId: req.sessionId,
            contentId: req.contentId,
            task,
            promptVersion: opts.promptVersion,
            usage: u,
            status: "ok",
          },
          deps.db,
        );
        return u;
      },
      async (e: unknown) => {
        const err = e instanceof LlmError ? e : new LlmError("provider_error", String(e), false, e);
        await failed(used, err, fallback);
        throw err;
      },
    );
    // Accounting failures are logged inside recordCall; callers may ignore usage.
    usage.catch(() => undefined);

    return { textStream: handle.textStream, usage, abort: () => controller.abort() };
  }

  async function object<T>(
    task: string,
    schema: z.ZodType<T>,
    req: EngineRequest,
    opts: CallOptions = {},
  ): Promise<ObjectResult<T>> {
    const { config, route, controller, adapterRequest } = await prepare(task, req, opts);
    const started = deps.now();
    void controller;

    const failed = async (r: ResolvedRoute, e: LlmError, fallback: boolean) => {
      await recordCall(
        {
          orgId: req.orgId,
          sessionId: req.sessionId,
          contentId: req.contentId,
          task,
          promptVersion: opts.promptVersion,
          usage: toUsage(
            config,
            r,
            { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            0,
            deps.now() - started,
            fallback,
          ),
          status: e.code === "timeout" ? "timeout" : "error",
          errorCode: e.code,
        },
        deps.db,
      );
    };

    // One repair retry for invalid structured output: the validation error goes back in the final message.
    const attempt = async (r: ResolvedRoute) => {
      const base = adapterRequest(r);
      try {
        return await deps.adapters[r.provider].object(base, schema);
      } catch (e) {
        if (!(e instanceof LlmError) || e.code !== "invalid_output") throw e;
        log.warn({ event: "llm_object_repair", task, reason: e.message });
        return deps.adapters[r.provider].object(
          {
            ...base,
            final: `${base.final}\n\nYour previous answer did not match the required schema: ${e.message}. Answer again with valid JSON only.`,
          },
          schema,
        );
      }
    };

    const {
      value,
      route: used,
      fallback,
    } = await withRetriesAndFallback(config, route, attempt, failed);
    const latency = deps.now() - started;
    const u = toUsage(config, used, value.usage, latency, latency, fallback);
    await recordCall(
      {
        orgId: req.orgId,
        sessionId: req.sessionId,
        contentId: req.contentId,
        task,
        promptVersion: opts.promptVersion,
        usage: u,
        status: "ok",
      },
      deps.db,
    );
    return { value: value.value, usage: u };
  }

  /** Prefix token count for the cache floor check (cached by pack hash). */
  async function countTokens(task: string, req: EngineRequest): Promise<number> {
    const { route, adapterRequest } = await prepare(task, req, {});
    return deps.adapters[route.provider].countTokens(adapterRequest(route));
  }

  return {
    stream,
    object,
    countTokens,
    resolveRoute: (config: Config, task: string, lang?: Lang) => resolveRoute(config, task, lang),
  };
}

export const llm = createLlm();
export type Llm = ReturnType<typeof createLlm>;
