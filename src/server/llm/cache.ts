import type Anthropic from "@anthropic-ai/sdk";
import type { AdapterRequest } from "./types";

export const MAX_BREAKPOINTS = 4;

/**
 * Anthropic request shape: system = rules + pack blocks with
 * breakpoint 1 on the last pack block; history with breakpoint 2 on its last
 * message; the final message is never cached. Volatile inputs live only in `final`.
 */
export function toAnthropicRequest(req: AdapterRequest): {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  breakpoints: number;
} {
  const ttl =
    req.cacheTtl === "1h"
      ? { type: "ephemeral" as const, ttl: "1h" as const }
      : { type: "ephemeral" as const };
  let breakpoints = 0;

  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: req.system }];
  for (const block of req.packBlocks) system.push({ type: "text", text: block });
  const lastSystem = system[system.length - 1]!;
  lastSystem.cache_control = ttl;
  breakpoints++;

  const messages: Anthropic.MessageParam[] = req.history.map((h) => ({
    role: h.role,
    content: [{ type: "text", text: h.text }],
  }));
  if (messages.length) {
    const last = messages[messages.length - 1]!;
    (last.content as Anthropic.TextBlockParam[])[0]!.cache_control = ttl;
    breakpoints++;
  }
  messages.push({ role: "user", content: [{ type: "text", text: req.final }] });

  if (breakpoints > MAX_BREAKPOINTS) throw new Error(`Too many cache breakpoints: ${breakpoints}`);
  return { system, messages, breakpoints };
}

export function countBreakpoints(
  system: Anthropic.TextBlockParam[],
  messages: Anthropic.MessageParam[],
): number {
  let n = system.filter((b) => b.cache_control).length;
  for (const m of messages) {
    if (Array.isArray(m.content))
      n += m.content.filter((c) => "cache_control" in c && c.cache_control).length;
  }
  return n;
}
