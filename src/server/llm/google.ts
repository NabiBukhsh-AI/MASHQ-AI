import { GoogleGenAI, type Content } from "@google/genai";
import { z } from "zod";
import { env } from "@/env";
import { LlmError } from "./errors";
import type { Adapter, AdapterRequest, RawUsage } from "./types";

// Secondary provider. Same request shape as the primary; Gemini has implicit
// caching, so no breakpoints are set here.

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new LlmError("provider_error", "GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  }
  client ??= new GoogleGenAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
  return client;
}

function contents(req: AdapterRequest): Content[] {
  const history: Content[] = req.history.map((h) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.text }],
  }));
  return [...history, { role: "user", parts: [{ text: req.final }] }];
}

function systemInstruction(req: AdapterRequest): string {
  return [req.system, ...req.packBlocks].join("\n\n");
}

function usageOf(
  meta:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
        thoughtsTokenCount?: number;
      }
    | undefined,
): RawUsage {
  const cached = meta?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (meta?.promptTokenCount ?? 0) - cached),
    outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

function mapError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  const message = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number })?.status;
  if (status === 429 || /429|RESOURCE_EXHAUSTED/.test(message))
    return new LlmError("rate_limited", message, true, e);
  if ((status && status >= 500) || /5\d\d|UNAVAILABLE|DEADLINE/.test(message))
    return new LlmError("provider_error", message, true, e);
  if (e instanceof Error && e.name === "AbortError")
    return new LlmError("aborted", "Request aborted.", false, e);
  return new LlmError("provider_error", message, false, e);
}

export const googleAdapter: Adapter = {
  async stream(req) {
    let stream: AsyncGenerator<{ text?: string; usageMetadata?: Parameters<typeof usageOf>[0] }>;
    try {
      stream = await getClient().models.generateContentStream({
        model: req.model,
        contents: contents(req),
        config: {
          systemInstruction: systemInstruction(req),
          maxOutputTokens: req.maxOutputTokens,
          temperature: req.temperature,
          abortSignal: req.signal,
          httpOptions: { timeout: req.timeoutMs },
        },
      });
    } catch (e) {
      throw mapError(e);
    }

    let resolveUsage!: (u: RawUsage) => void;
    let rejectUsage!: (e: unknown) => void;
    const usage = new Promise<RawUsage>((res, rej) => {
      resolveUsage = res;
      rejectUsage = rej;
    });

    // First chunk gate: failures before any text surface as a rejected stream() call.
    const iterator = stream[Symbol.asyncIterator]();
    let firstChunk: IteratorResult<{
      text?: string;
      usageMetadata?: Parameters<typeof usageOf>[0];
    }>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      firstChunk = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new LlmError(
                  "first_token_timeout",
                  `No first token within ${req.firstTokenTimeoutMs} ms.`,
                  true,
                ),
              ),
            req.firstTokenTimeoutMs,
          );
        }),
      ]);
    } catch (e) {
      throw mapError(e);
    } finally {
      if (timer) clearTimeout(timer);
    }

    async function* text(): AsyncIterable<string> {
      let last = firstChunk.value;
      try {
        let current = firstChunk;
        while (!current.done) {
          last = current.value;
          if (current.value.text) yield current.value.text;
          current = await iterator.next();
        }
        resolveUsage(usageOf(last?.usageMetadata));
      } catch (e) {
        const mapped = mapError(e);
        rejectUsage(mapped);
        throw mapped;
      }
    }

    return { textStream: text(), usage };
  },

  async object(req, schema) {
    try {
      const response = await getClient().models.generateContent({
        model: req.model,
        contents: contents(req),
        config: {
          systemInstruction: systemInstruction(req),
          maxOutputTokens: req.maxOutputTokens,
          temperature: req.temperature,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema as z.ZodType),
          abortSignal: req.signal,
          httpOptions: { timeout: req.timeoutMs },
        },
      });
      const raw = response.text;
      if (!raw) throw new LlmError("invalid_output", "Empty structured response.", true);
      const parsed = schema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new LlmError(
          "invalid_output",
          `Structured output failed validation: ${parsed.error.issues[0]?.message}`,
          true,
        );
      }
      return { value: parsed.data, usage: usageOf(response.usageMetadata) };
    } catch (e) {
      throw mapError(e);
    }
  },

  async countTokens(req) {
    const r = await getClient().models.countTokens({
      model: req.model,
      contents: [{ role: "user", parts: [{ text: systemInstruction(req) }] }, ...contents(req)],
    });
    return r.totalTokens ?? 0;
  },
};
