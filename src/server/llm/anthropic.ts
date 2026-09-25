import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/env";
import { toAnthropicRequest } from "./cache";
import { LlmError } from "./errors";
import type { Adapter, AdapterRequest, RawUsage } from "./types";

// Sonnet 5 and the Opus 5 family reject sampling parameters; Haiku 4.5 accepts them.
const SAMPLING_OK = /^claude-(haiku-4-5|sonnet-4-6|opus-4-6|haiku-3|sonnet-4|opus-4-1)/;
const THINKING_DEFAULT_ON = /^claude-(sonnet-5|opus-5|fable)/;

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
  return client;
}

function usageOf(u: Anthropic.Usage): RawUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function baseParams(req: AdapterRequest) {
  const { system, messages } = toAnthropicRequest(req);
  return {
    model: req.model,
    max_tokens: req.maxOutputTokens,
    system,
    messages,
    ...(SAMPLING_OK.test(req.model) ? { temperature: req.temperature } : {}),
    // Design and grading tasks are structured and latency-bound; adaptive thinking
    // (on by default from Sonnet 5 up) would spend output tokens and seconds we do
    // not have. Haiku 4.5 has no thinking unless asked.
    ...(THINKING_DEFAULT_ON.test(req.model) ? { thinking: { type: "disabled" as const } } : {}),
  } satisfies Anthropic.MessageCreateParams;
}

function mapError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  // The SDK's structured-output parser throws a plain error on truncated or malformed JSON.
  if (
    e instanceof SyntaxError ||
    (e instanceof Error &&
      /JSON|parse/i.test(e.name + e.message) &&
      !(e instanceof Anthropic.APIError))
  ) {
    return new LlmError(
      "invalid_output",
      `The model returned malformed structured output: ${e.message.slice(0, 120)}`,
      true,
      e,
    );
  }
  if (e instanceof Anthropic.RateLimitError)
    return new LlmError("rate_limited", e.message, true, e);
  if (e instanceof Anthropic.APIConnectionTimeoutError)
    return new LlmError("timeout", e.message, true, e);
  if (e instanceof Anthropic.APIConnectionError)
    return new LlmError("provider_error", e.message, true, e);
  if (e instanceof Anthropic.InternalServerError)
    return new LlmError("provider_error", e.message, true, e);
  if (e instanceof Anthropic.APIError) return new LlmError("provider_error", e.message, false, e);
  if (e instanceof Error && e.name === "AbortError")
    return new LlmError("aborted", "Request aborted.", false, e);
  return new LlmError("provider_error", e instanceof Error ? e.message : String(e), false, e);
}

export const anthropicAdapter: Adapter = {
  async stream(req) {
    const stream = getClient().messages.stream(baseParams(req), {
      signal: req.signal,
      timeout: req.timeoutMs,
    });

    // Wait for the first token (or a failure) before handing the stream over, so
    // retries and fallback happen before any text reaches the caller.
    const iterator = stream[Symbol.asyncIterator]();
    const first = await firstText(iterator, req.firstTokenTimeoutMs, stream);

    async function* text(): AsyncIterable<string> {
      try {
        if (first !== null) yield first;
        for (;;) {
          const { value, done } = await iterator.next();
          if (done) return;
          if (value.type === "content_block_delta" && value.delta.type === "text_delta")
            yield value.delta.text;
        }
      } catch (e) {
        throw mapError(e);
      }
    }

    const usage = stream.finalMessage().then(
      (m) => {
        if (m.stop_reason === "refusal")
          throw new LlmError("refusal", "The model declined this request.");
        return usageOf(m.usage);
      },
      (e) => {
        throw mapError(e);
      },
    );

    return { textStream: text(), usage };
  },

  async object(req, schema) {
    try {
      const format = zodOutputFormat(schema as z.ZodType);
      const message = await getClient().messages.parse(
        { ...baseParams(req), output_config: { format } },
        { signal: req.signal, timeout: req.timeoutMs },
      );
      if (message.stop_reason === "refusal")
        throw new LlmError("refusal", "The model declined this request.");
      if (message.stop_reason === "max_tokens") {
        throw new LlmError(
          "invalid_output",
          "The model's answer was cut off at the token limit; raise maxOutputTokens for this task.",
          false,
        );
      }
      if (message.parsed_output === null || message.parsed_output === undefined) {
        throw new LlmError(
          "invalid_output",
          "The model returned output that did not match the schema.",
          true,
        );
      }
      return {
        value: message.parsed_output as z.infer<typeof schema>,
        usage: usageOf(message.usage),
      };
    } catch (e) {
      // Large schemas (mission packs) exceed the constrained-decoding grammar limit.
      // Fall back to JSON in text, validated by the same Zod schema.
      if (
        e instanceof Anthropic.BadRequestError &&
        /grammar is too large|too complex/i.test(e.message)
      ) {
        return jsonInText(req, schema);
      }
      throw mapError(e);
    }
  },

  async countTokens(req) {
    const { system, messages } = toAnthropicRequest(req);
    const r = await getClient().messages.countTokens({ model: req.model, system, messages });
    return r.input_tokens;
  },
};

/** Resolve to the first text delta, null when the stream ends without text, or throw on timeout or error. */
async function firstText(
  iterator: AsyncIterator<Anthropic.MessageStreamEvent>,
  timeoutMs: number,
  stream: { abort(): void },
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stream.abort();
      reject(new LlmError("first_token_timeout", `No first token within ${timeoutMs} ms.`, true));
    }, timeoutMs);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([iterator.next(), timeout]);
      if (done) return null;
      if (value.type === "content_block_delta" && value.delta.type === "text_delta")
        return value.delta.text;
    }
  } catch (e) {
    throw mapError(e);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Structured output without constrained decoding: schema in the prompt, JSON parsed from the text. */
async function jsonInText<T>(
  req: AdapterRequest,
  schema: z.ZodType<T>,
): Promise<{ value: T; usage: RawUsage }> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const params = baseParams(req);
  const message = await getClient().messages.create(
    {
      ...params,
      system: [
        ...params.system,
        {
          type: "text",
          text: `Respond with exactly one JSON object and nothing else (no prose, no code fences). It must match this JSON schema:
${jsonSchema}`,
        },
      ],
    },
    { signal: req.signal, timeout: req.timeoutMs },
  );
  if (message.stop_reason === "refusal")
    throw new LlmError("refusal", "The model declined this request.");
  if (message.stop_reason === "max_tokens") {
    throw new LlmError(
      "invalid_output",
      "The model's answer was cut off at the token limit; raise maxOutputTokens for this task.",
      false,
    );
  }
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new LlmError("invalid_output", "The model returned no JSON object.", true);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new LlmError(
      "invalid_output",
      `The model returned malformed JSON: ${(err as Error).message.slice(0, 120)}`,
      true,
      err,
    );
  }
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new LlmError(
      "invalid_output",
      `Structured output failed validation at ${first?.path.join(".")}: ${first?.message}`,
      true,
    );
  }
  return { value: parsed.data, usage: usageOf(message.usage) };
}
