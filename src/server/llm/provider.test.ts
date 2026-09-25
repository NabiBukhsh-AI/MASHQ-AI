import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { createLlm, type LlmDeps } from "./provider";
import { LlmError } from "./errors";
import { DEFAULT_CONFIG } from "../config/defaults";
import { bustSpendCache } from "../security/spend";
import type { Adapter, AdapterRequest, AdapterStream, RawUsage, EngineRequest } from "./types";
import type { Config } from "../config/schema";
import { resetBreakers } from "./breaker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RAW_USAGE: RawUsage = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 500,
  cacheWriteTokens: 100,
};

function fakeRequest(overrides: Partial<EngineRequest> = {}): EngineRequest {
  return {
    system: "You are a test tutor.",
    packBlocks: ["Rule A.", "Rule B."],
    history: [
      { role: "user", text: "Hello, my CNIC is 42201-1234567-1." },
      { role: "assistant", text: "Got it." },
    ],
    final: "What is the meaning of compliance?",
    orgId: "org-1",
    sessionId: "sess-1",
    ...overrides,
  };
}

async function drain(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const c of stream) chunks.push(c);
  return chunks;
}

/** A test config based on defaults with minimal routes. */
function testConfig(overrides: Partial<Config["llm"]> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      tiers: {
        fast: { provider: "anthropic", model: "claude-haiku-4-5" },
        design: { provider: "anthropic", model: "claude-sonnet-5" },
        fallback: { provider: "google", model: "gemini-3.8-flash" },
        embed: { provider: "google", model: "gemini-embedding-001" },
      },
      routes: {
        "turn.respond": {
          tier: "fast",
          maxOutputTokens: 450,
          temperature: 0.5,
          timeoutMs: 30_000,
          firstTokenTimeoutMs: 6_000,
        },
      },
      fallback: { enabled: true, force: false },
      retries: { max: 1, baseMs: 10 },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Fake adapter: records every call for inspection
// ---------------------------------------------------------------------------

interface FakeCall {
  method: "stream" | "object" | "countTokens";
  req: AdapterRequest;
  schema?: z.ZodType;
}

function createFakeAdapter(
  opts: {
    streamResult?: () => AdapterStream | Promise<AdapterStream>;
    objectResult?: () =>
      { value: unknown; usage: RawUsage } | Promise<{ value: unknown; usage: RawUsage }>;
    countResult?: () => number;
    failWith?: () => LlmError;
    /** After this many calls, stop failing. */
    failCount?: number;
  } = {},
): { adapter: Adapter; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let failures = 0;

  function maybeThrow() {
    if (opts.failWith && (opts.failCount === undefined || failures < opts.failCount)) {
      failures++;
      throw opts.failWith();
    }
  }

  async function* defaultText(): AsyncIterable<string> {
    yield "Hello ";
    yield "world.";
  }

  const adapter: Adapter = {
    async stream(req) {
      calls.push({ method: "stream", req });
      maybeThrow();
      if (opts.streamResult) return opts.streamResult();
      return {
        textStream: defaultText(),
        usage: Promise.resolve({ ...RAW_USAGE }),
      };
    },
    async object<T>(
      req: AdapterRequest,
      schema: z.ZodType<T>,
    ): Promise<{ value: T; usage: RawUsage }> {
      calls.push({ method: "object", req, schema });
      maybeThrow();
      if (opts.objectResult) {
        const res = await opts.objectResult();
        return { value: res.value as T, usage: res.usage };
      }
      return { value: { answer: "test" } as T, usage: { ...RAW_USAGE } };
    },
    async countTokens(req) {
      calls.push({ method: "countTokens", req });
      if (opts.countResult) return opts.countResult();
      return 5000;
    },
  };

  return { adapter, calls };
}

// ---------------------------------------------------------------------------
// Fake DB: captures inserts and selects
// ---------------------------------------------------------------------------

interface DbCapture {
  llmCallInserts: Record<string, unknown>[];
  sessionUpdates: unknown[];
  spendInserts: unknown[];
}

// ---------------------------------------------------------------------------
// Build deps
// ---------------------------------------------------------------------------

function buildDeps(
  opts: {
    config?: Config;
    anthropic?: Adapter;
    google?: Adapter;
    db?: LlmDeps["db"];
    spendState?: "ok" | "degrade" | "block";
    sessionTokensUsed?: number;
  } = {},
): LlmDeps {
  const config = opts.config ?? testConfig();
  const sessionTokens = opts.sessionTokensUsed ?? 0;

  // A thennable result that also supports .limit() for Drizzle chain compatibility.
  // spend.ts does: const [row] = await db.select(...).from(...).where(...)
  // budget.ts does: const [row] = await db.select(...).from(...).where(...).limit(1)
  // Both destructure an awaitable array.
  function thennable(rows: unknown[]) {
    const obj = {
      limit: () => thennable(rows),
      then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(rows).then(resolve, reject),
      [Symbol.iterator]: () => rows[Symbol.iterator](),
    };
    return obj;
  }

  function spendUsdString(): string {
    if (opts.spendState === "block") return String(config.limits.dailySpendCapUsd);
    if (opts.spendState === "degrade")
      return String((config.limits.dailySpendCapUsd * config.limits.degradeAtPercent) / 100);
    return "0";
  }

  // Drizzle stores table names as Symbol.for("drizzle:Name"), not as _.name.
  const drizzleName = Symbol.for("drizzle:Name");
  function tableName(table: unknown): string {
    return (table as Record<symbol, string>)?.[drizzleName] ?? "unknown";
  }

  // A captured-db that also records inserts for assertions.
  const captured: DbCapture = {
    llmCallInserts: [],
    sessionUpdates: [],
    spendInserts: [],
  };

  const fakeDb = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "select") {
          return () => ({
            from: (table: unknown) => {
              const name = tableName(table);
              if (name === "learning_sessions") {
                return {
                  where: () => thennable(sessionTokens >= 0 ? [{ tokensUsed: sessionTokens }] : []),
                };
              }
              if (name === "spend_daily") {
                return {
                  where: () => thennable([{ usd: spendUsdString() }]),
                };
              }
              return {
                where: () => thennable([]),
              };
            },
          });
        }
        if (prop === "insert") {
          return (table: unknown) => {
            const name = tableName(table);
            return {
              values(vals: Record<string, unknown>) {
                if (name === "llm_calls") captured.llmCallInserts.push(vals);
                if (name === "spend_daily") captured.spendInserts.push(vals);
                return {
                  onConflictDoUpdate() {
                    return Promise.resolve();
                  },
                  then(resolve: (v: unknown) => void) {
                    resolve(undefined);
                  },
                };
              },
            };
          };
        }
        if (prop === "update") {
          return () => ({
            set: (vals: unknown) => {
              captured.sessionUpdates.push(vals);
              return {
                where: () => Promise.resolve(),
              };
            },
          });
        }
        return undefined;
      },
    },
  ) as unknown as LlmDeps["db"];

  const db = opts.db ?? fakeDb;

  const { adapter: defaultAnth } = createFakeAdapter();
  const { adapter: defaultGoogle } = createFakeAdapter();

  return {
    adapters: {
      anthropic: opts.anthropic ?? defaultAnth,
      google: opts.google ?? defaultGoogle,
    },
    db,
    loadConfig: async () => ({ config, version: 1 }),
    now: (() => {
      let t = 0;
      return () => (t += 50);
    })(),
    _captured: captured,
  } as LlmDeps & { _captured: DbCapture };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("provider module", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    bustSpendCache();
    // Breaker state is deliberately process wide, so tests have to clear it or a route
    // one test opened would be skipped by the next.
    resetBreakers();
  });

  // -------------------------------------------------------------------------
  // 1. Breakpoint placement: at most 4, correct positions
  // -------------------------------------------------------------------------
  describe("cache breakpoints", () => {
    it("places at most 4 breakpoints and on the right positions", async () => {
      const { adapter, calls } = createFakeAdapter();
      const deps = buildDeps({ anthropic: adapter });
      const llm = createLlm(deps);

      const req = fakeRequest();
      const handle = await llm.stream("turn.respond", req);
      // Drain the stream
      const chunks: string[] = [];
      for await (const c of handle.textStream) chunks.push(c);

      expect(calls).toHaveLength(1);
      const sent = calls[0]!.req;

      // The cache module is tested separately, but let us verify the adapter
      // receives the same structure the cache module would build. Import the
      // helper to count breakpoints on what the adapter sees.
      const { toAnthropicRequest } = await import("./cache");
      const { messages, breakpoints } = toAnthropicRequest(sent);

      expect(breakpoints).toBeLessThanOrEqual(4);
      // With 2 pack blocks (system has 3 blocks: system + 2 packs), history has 2 messages,
      // and 1 final message: breakpoint 1 on the last system block, breakpoint 2 on last history message.
      expect(breakpoints).toBe(2);

      // Verify: the final message has no cache_control
      const finalMsg = messages[messages.length - 1]!;
      const finalBlocks = finalMsg.content as { cache_control?: unknown }[];
      expect(finalBlocks.every((b) => !b.cache_control)).toBe(true);
    });

    it("puts one breakpoint when there is no history", async () => {
      const { adapter, calls } = createFakeAdapter();
      const deps = buildDeps({ anthropic: adapter });
      const llm = createLlm(deps);

      const req = fakeRequest({ history: [] });
      const handle = await llm.stream("turn.respond", req);
      await drain(handle.textStream);

      const sent = calls[0]!.req;
      const { breakpoints } = (await import("./cache")).toAnthropicRequest(sent);
      expect(breakpoints).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Redaction reaches the adapter
  // -------------------------------------------------------------------------
  describe("redaction", () => {
    it("redacts PII from system, packBlocks, history and final before the adapter sees them", async () => {
      const { adapter, calls } = createFakeAdapter();
      const deps = buildDeps({ anthropic: adapter });
      const llm = createLlm(deps);

      const req = fakeRequest({
        system: "System with phone 0300-1234567.",
        packBlocks: ["Pack with CNIC 42201-1234567-1."],
        history: [
          { role: "user", text: "My email is test@example.com." },
          { role: "assistant", text: "Noted." },
        ],
        final: "My IBAN is PK36SCBL0000001123456702.",
      });

      const handle = await llm.stream("turn.respond", req);
      await drain(handle.textStream);

      const sent = calls[0]!.req;
      // Phone should be redacted
      expect(sent.system).not.toContain("0300-1234567");
      expect(sent.system).toContain("[PHONE");

      // CNIC in pack block
      expect(sent.packBlocks[0]).not.toContain("42201-1234567-1");
      expect(sent.packBlocks[0]).toContain("[CNIC");

      // Email in history
      expect(sent.history[0]!.text).not.toContain("test@example.com");
      expect(sent.history[0]!.text).toContain("[EMAIL");

      // IBAN in final
      expect(sent.final).not.toContain("PK36SCBL0000001123456702");
      expect(sent.final).toContain("[IBAN");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Budget rejection before any adapter call
  // -------------------------------------------------------------------------
  describe("budget checks", () => {
    it("throws spend_blocked before calling the adapter when org spend is at cap", async () => {
      const { adapter, calls } = createFakeAdapter();
      const deps = buildDeps({ anthropic: adapter, spendState: "block" });
      const llm = createLlm(deps);

      await expect(llm.stream("turn.respond", fakeRequest())).rejects.toThrow(LlmError);
      await expect(llm.stream("turn.respond", fakeRequest())).rejects.toMatchObject({
        code: "spend_blocked",
      });

      // Adapter was never called
      expect(calls).toHaveLength(0);
    });

    it("throws budget_exceeded before calling the adapter when session tokens exceed budget", async () => {
      const { adapter, calls } = createFakeAdapter();
      const deps = buildDeps({
        anthropic: adapter,
        sessionTokensUsed: DEFAULT_CONFIG.limits.tokenBudgetPerSession + 1,
      });
      const llm = createLlm(deps);

      await expect(llm.stream("turn.respond", fakeRequest())).rejects.toMatchObject({
        code: "budget_exceeded",
      });

      expect(calls).toHaveLength(0);
    });

    it("proceeds when spend state is degrade (not blocked)", async () => {
      const { adapter, calls } = createFakeAdapter();
      const deps = buildDeps({ anthropic: adapter, spendState: "degrade" });
      const llm = createLlm(deps);

      const handle = await llm.stream("turn.respond", fakeRequest());
      await drain(handle.textStream);

      expect(calls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Usage and cost math
  // -------------------------------------------------------------------------
  describe("usage and cost", () => {
    it("computes cost from config pricing and returns correct usage fields", async () => {
      const config = testConfig();
      const { adapter } = createFakeAdapter();
      const deps = buildDeps({ config, anthropic: adapter });
      const llm = createLlm(deps);

      const handle = await llm.stream("turn.respond", fakeRequest());
      await drain(handle.textStream);

      const usage = await handle.usage;

      expect(usage.tier).toBe("fast");
      expect(usage.provider).toBe("anthropic");
      expect(usage.model).toBe("claude-haiku-4-5");
      expect(usage.inputTokens).toBe(RAW_USAGE.inputTokens);
      expect(usage.outputTokens).toBe(RAW_USAGE.outputTokens);
      expect(usage.cacheReadTokens).toBe(RAW_USAGE.cacheReadTokens);
      expect(usage.cacheWriteTokens).toBe(RAW_USAGE.cacheWriteTokens);
      expect(usage.fallback).toBe(false);
      expect(usage.ttftMs).toBeGreaterThan(0);
      expect(usage.latencyMs).toBeGreaterThanOrEqual(usage.ttftMs);

      // Verify cost math: for claude-haiku-4-5 with pricing
      // in=1 per M, out=5 per M, cacheRead=0.1*in, cacheWrite=1.25*in
      const p = config.llm.pricing["claude-haiku-4-5"]!;
      const expectedCost =
        Math.round(
          (RAW_USAGE.inputTokens * (p.inPerM / 1e6) +
            RAW_USAGE.cacheReadTokens * (p.inPerM / 1e6) * p.cacheReadMult +
            RAW_USAGE.cacheWriteTokens * (p.inPerM / 1e6) * p.cacheWriteMult +
            RAW_USAGE.outputTokens * (p.outPerM / 1e6)) *
            1e6,
        ) / 1e6;
      expect(usage.costUsd).toBe(expectedCost);
    });

    it("returns 0 cost for an unknown model", async () => {
      const config = testConfig({
        tiers: {
          ...testConfig().llm.tiers,
          fast: { provider: "anthropic", model: "claude-unknown-99" },
        },
      });
      const { adapter } = createFakeAdapter();
      const deps = buildDeps({ config, anthropic: adapter });
      const llm = createLlm(deps);

      const handle = await llm.stream("turn.respond", fakeRequest());
      await drain(handle.textStream);
      const usage = await handle.usage;
      expect(usage.costUsd).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. llm_calls row via mocked DB
  // -------------------------------------------------------------------------
  describe("tracing: llm_calls row", () => {
    it("inserts an llm_calls row on a successful stream call", async () => {
      const { adapter } = createFakeAdapter();
      const deps = buildDeps({ anthropic: adapter });
      const llm = createLlm(deps);

      const handle = await llm.stream("turn.respond", fakeRequest());
      await drain(handle.textStream);
      // Wait for the usage promise to resolve (triggers recordCall)
      await handle.usage;
      // Give the async recording a tick
      await new Promise((r) => setTimeout(r, 50));

      const captured = (deps as LlmDeps & { _captured: DbCapture })._captured;
      expect(captured.llmCallInserts.length).toBeGreaterThanOrEqual(1);
      const row = captured.llmCallInserts.find((r) => r.status === "ok");
      expect(row).toBeDefined();
      expect(row!.task).toBe("turn.respond");
      expect(row!.orgId).toBe("org-1");
      expect(row!.tier).toBe("fast");
      expect(row!.provider).toBe("anthropic");
      expect(row!.model).toBe("claude-haiku-4-5");
      expect(row!.inputTokens).toBe(RAW_USAGE.inputTokens);
      expect(row!.outputTokens).toBe(RAW_USAGE.outputTokens);
      expect(row!.fallback).toBe(false);
    });

    it("inserts an llm_calls row on a successful object call", async () => {
      const schema = z.object({ answer: z.string() });
      const { adapter } = createFakeAdapter({
        objectResult: () => ({
          value: { answer: "hello" },
          usage: { ...RAW_USAGE },
        }),
      });
      const deps = buildDeps({ anthropic: adapter });
      const llm = createLlm(deps);

      const result = await llm.object("turn.respond", schema, fakeRequest());
      await new Promise((r) => setTimeout(r, 50));

      expect(result.value).toEqual({ answer: "hello" });
      const captured = (deps as LlmDeps & { _captured: DbCapture })._captured;
      expect(captured.llmCallInserts.length).toBeGreaterThanOrEqual(1);
      const row = captured.llmCallInserts.find((r) => r.status === "ok");
      expect(row).toBeDefined();
      expect(row!.task).toBe("turn.respond");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Volatile inputs only in the final message
  // -------------------------------------------------------------------------
  describe("volatile inputs", () => {
    it("places volatile request data only in the final message, not in cached prefix", async () => {
      const { adapter, calls } = createFakeAdapter();
      const deps = buildDeps({ anthropic: adapter });
      const llm = createLlm(deps);

      const volatileFinal = "Learner persona: novice. Language: ur. Session state: active.";
      const req = fakeRequest({ final: volatileFinal });
      const handle = await llm.stream("turn.respond", req);
      await drain(handle.textStream);

      const sent = calls[0]!.req;

      // The final message should contain the volatile content (redacted but still recognizable structure)
      // System and packBlocks should NOT contain the volatile text
      expect(sent.system).not.toContain("persona");
      expect(sent.system).not.toContain("Session state");
      for (const block of sent.packBlocks) {
        expect(block).not.toContain("persona");
        expect(block).not.toContain("Session state");
      }
      // History should not contain it either
      for (const h of sent.history) {
        expect(h.text).not.toContain("persona");
        expect(h.text).not.toContain("Session state");
      }

      // The final message should still have the intent
      expect(sent.final).toContain("persona");
    });
  });

  // -------------------------------------------------------------------------
  // 7. Fallback on retryable failure
  // -------------------------------------------------------------------------
  describe("fallback", () => {
    it("falls back to the fallback tier on retryable failures from the primary", async () => {
      const { adapter: anthAdapter, calls: anthCalls } = createFakeAdapter({
        failWith: () => new LlmError("provider_error", "Server error", true),
      });
      const { adapter: googleAdapter, calls: googleCalls } = createFakeAdapter();
      const config = testConfig({ retries: { max: 0, baseMs: 10 } });
      const deps = buildDeps({ config, anthropic: anthAdapter, google: googleAdapter });
      const llm = createLlm(deps);

      const handle = await llm.stream("turn.respond", fakeRequest());
      const chunks = await drain(handle.textStream);

      // Primary failed, fallback succeeded
      expect(anthCalls).toHaveLength(1);
      expect(googleCalls).toHaveLength(1);
      expect(chunks.join("")).toBe("Hello world.");

      const usage = await handle.usage;
      expect(usage.fallback).toBe(true);
      expect(usage.provider).toBe("google");
      expect(usage.tier).toBe("fallback");
    });

    it("retries the primary before falling back", async () => {
      const { adapter: anthAdapter, calls: anthCalls } = createFakeAdapter({
        failWith: () => new LlmError("rate_limited", "429", true),
      });
      const { adapter: googleAdapter, calls: googleCalls } = createFakeAdapter();
      const config = testConfig({ retries: { max: 2, baseMs: 1 } });
      const deps = buildDeps({ config, anthropic: anthAdapter, google: googleAdapter });
      const llm = createLlm(deps);

      const handle = await llm.stream("turn.respond", fakeRequest());
      await drain(handle.textStream);

      // Primary: 1 original + 2 retries = 3 attempts, then fallback
      expect(anthCalls).toHaveLength(3);
      expect(googleCalls).toHaveLength(1);
    });

    it("does not fall back on non-retryable errors (e.g. refusal)", async () => {
      const { adapter: anthAdapter } = createFakeAdapter({
        failWith: () => new LlmError("refusal", "Refused", false),
      });
      const { adapter: googleAdapter, calls: googleCalls } = createFakeAdapter();
      const deps = buildDeps({ anthropic: anthAdapter, google: googleAdapter });
      const llm = createLlm(deps);

      await expect(llm.stream("turn.respond", fakeRequest())).rejects.toMatchObject({
        code: "refusal",
      });

      // Fallback was never tried
      expect(googleCalls).toHaveLength(0);
    });

    it("does not fall back when fallback is disabled", async () => {
      const { adapter: anthAdapter } = createFakeAdapter({
        failWith: () => new LlmError("provider_error", "Crash", true),
      });
      const { adapter: googleAdapter, calls: googleCalls } = createFakeAdapter();
      const config = testConfig({
        fallback: { enabled: false, force: false },
        retries: { max: 0, baseMs: 10 },
      });
      const deps = buildDeps({ config, anthropic: anthAdapter, google: googleAdapter });
      const llm = createLlm(deps);

      await expect(llm.stream("turn.respond", fakeRequest())).rejects.toThrow(LlmError);
      expect(googleCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 8. object() repair retry on invalid_output
  // -------------------------------------------------------------------------
  describe("object repair retry", () => {
    it("retries once with the validation error appended to the final message", async () => {
      let callCount = 0;
      const schema = z.object({ score: z.number() });
      const { adapter, calls } = createFakeAdapter({
        objectResult: () => {
          callCount++;
          if (callCount === 1) {
            throw new LlmError(
              "invalid_output",
              "Expected number, received string at path .score",
              true,
            );
          }
          return { value: { score: 42 }, usage: { ...RAW_USAGE } };
        },
      });
      const deps = buildDeps({ anthropic: adapter });
      const llm = createLlm(deps);

      const result = await llm.object("turn.respond", schema, fakeRequest());
      expect(result.value).toEqual({ score: 42 });

      // Two adapter calls: original + repair
      expect(calls).toHaveLength(2);

      // The repair call's final message should mention the schema error
      const repairReq = calls[1]!.req;
      expect(repairReq.final).toContain("did not match the required schema");
      expect(repairReq.final).toContain("Expected number");
    });
  });

  // -------------------------------------------------------------------------
  // 9. countTokens delegates correctly
  // -------------------------------------------------------------------------
  describe("countTokens", () => {
    it("delegates to the routed adapter and returns the count", async () => {
      const { adapter, calls } = createFakeAdapter({ countResult: () => 7777 });
      const deps = buildDeps({ anthropic: adapter });
      const llm = createLlm(deps);

      const count = await llm.countTokens("turn.respond", fakeRequest());
      expect(count).toBe(7777);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.method).toBe("countTokens");
    });
  });

  // -------------------------------------------------------------------------
  // 10. Route resolution
  // -------------------------------------------------------------------------
  describe("resolveRoute", () => {
    it("resolves a known task to its tier and model", () => {
      const config = testConfig();
      const llm = createLlm(buildDeps({ config }));
      const route = llm.resolveRoute(config, "turn.respond");
      expect(route.tier).toBe("fast");
      expect(route.provider).toBe("anthropic");
      expect(route.model).toBe("claude-haiku-4-5");
    });

    it("throws no_route for an unknown task", () => {
      const config = testConfig();
      const llm = createLlm(buildDeps({ config }));
      expect(() => llm.resolveRoute(config, "unknown.task")).toThrow(LlmError);
    });
  });
});
