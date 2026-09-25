import type { z } from "zod";
import type { Lang, Provider, Tier } from "../config/schema";

/** What feature code sends: a stable prefix (system + pack), history, and one volatile final message. */
export interface EngineRequest {
  system: string;
  packBlocks: string[];
  history: { role: "user" | "assistant"; text: string }[];
  final: string;
  orgId: string;
  sessionId?: string;
  contentId?: string;
  lang?: Lang;
  /** Overrides the route's maxOutputTokens for this call only. */
  maxOutputTokens?: number;
}

export interface Usage {
  tier: Tier;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  ttftMs: number;
  latencyMs: number;
  fallback: boolean;
}

export interface StreamHandle {
  textStream: AsyncIterable<string>;
  usage: Promise<Usage>;
  abort(): void;
}

export interface ObjectResult<T> {
  value: T;
  usage: Usage;
}

/** Provider-neutral request an adapter receives: already redacted, already routed. */
export interface AdapterRequest {
  model: string;
  system: string;
  packBlocks: string[];
  history: { role: "user" | "assistant"; text: string }[];
  final: string;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  firstTokenTimeoutMs: number;
  cacheTtl: "5m" | "1h";
  signal: AbortSignal;
}

export interface RawUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AdapterStream {
  textStream: AsyncIterable<string>;
  usage: Promise<RawUsage>;
}

/** One per provider. Adapters know nothing about config, redaction, budgets or logging. */
export interface Adapter {
  stream(req: AdapterRequest): Promise<AdapterStream>;
  object<T>(req: AdapterRequest, schema: z.ZodType<T>): Promise<{ value: T; usage: RawUsage }>;
  countTokens(req: AdapterRequest): Promise<number>;
}
