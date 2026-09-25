import { TurnEvent } from "@/lib/schemas/turn-events";
import { signSpeech, type SpeechScope } from "../voice/speech-token";
import { stripMarkdown } from "./speech";
import { canaryTailLength, containsCanary, sanitizeCanary } from "../security/canary";

export interface ParseTurnStreamOpts {
  speechMode?: "auto" | "none" | "mirror" | "normalize" | "llm";
  allowedFactIds?: Set<string>;
  offeredMoveIds?: Set<string>;
  turnId?: string;
  lang?: string;
  scope?: SpeechScope;
  /** System prompt canary. Seeing it in model output means the prompt leaked. */
  canary?: string;
  maxSpeechChars?: number;
}

/**
 * Streaming parser for the TurnStream protocol.
 * Emits token-level display deltas, completed sentences, validated moves,
 * filtered facts, speech items, and protocol warnings.
 */
export async function* parseTurnStream(
  chunks: AsyncIterable<string>,
  opts: ParseTurnStreamOpts = {},
): AsyncIterable<TurnEvent> {
  let isStreamingDisplay = false;
  let currentSentence = "";
  /** Characters of currentSentence already sent as deltas. */
  let emitted = 0;
  /** Once the canary is seen, nothing more from this turn is displayed. */
  let canaryTripped = false;
  let linePrefixBuffer = "";
  let sentenceIndex = 0;
  let hasEnded = false;

  for await (const chunk of chunks) {
    if (hasEnded) break;
    let i = 0;

    while (i < chunk.length) {
      if (isStreamingDisplay) {
        // In display streaming mode: stream deltas until newline
        const newlineIdx = chunk.indexOf("\n", i);
        const atEnd = newlineIdx === -1;
        currentSentence += atEnd ? chunk.slice(i) : chunk.slice(i, newlineIdx);

        // A delta cannot be taken back: turn.ts forwards every event and the learner page
        // appends deltas to the live transcript, so a marker inside a delta is on screen
        // before the sentence is ever checked. Check what we have so far, and hold back only
        // the tail that could still be growing into the marker.
        if (!canaryTripped && opts.canary && containsCanary(currentSentence, opts.canary)) {
          canaryTripped = true;
        }
        if (!canaryTripped) {
          const hold = atEnd ? canaryTailLength(currentSentence, opts.canary) : 0;
          const safeEnd = Math.max(emitted, currentSentence.length - hold);
          if (safeEnd > emitted) {
            yield { type: "display.delta", text: currentSentence.slice(emitted, safeEnd) };
            emitted = safeEnd;
          }
        }

        if (atEnd) {
          i = chunk.length;
        } else {
          const text = currentSentence.trim();
          if (canaryTripped) {
            yield { type: "warning", message: "canary_leaked" };
            yield {
              type: "display.sentence",
              index: sentenceIndex++,
              text: sanitizeCanary(text, opts.canary),
            };
          } else {
            yield { type: "display.sentence", index: sentenceIndex++, text };
          }
          currentSentence = "";
          emitted = 0;
          isStreamingDisplay = false;
          i = newlineIdx + 1;
        }
      } else {
        // In tag-buffering mode: examine character by character
        const char = chunk[i];
        if (char === "\n") {
          // Line break encountered
          const line = linePrefixBuffer.trim();
          linePrefixBuffer = "";
          i++;

          if (!line) continue;

          const events = handleLine(line, opts, sentenceIndex);
          for (const ev of events) {
            if (ev.type === "display.sentence") {
              sentenceIndex++;
            }
            if (ev.type === "end") {
              hasEnded = true;
            }
            yield ev;
            if (hasEnded) break;
          }
          if (hasEnded) break;
        } else {
          linePrefixBuffer += char;
          i++;

          // Check if line prefix matches display streaming trigger
          if (linePrefixBuffer === "@@d " || linePrefixBuffer === "@@d\t") {
            isStreamingDisplay = true;
            linePrefixBuffer = "";
            currentSentence = "";
            emitted = 0;
          } else if (linePrefixBuffer === "@@x " || linePrefixBuffer === "@@x\t") {
            yield { type: "warning", message: "Model sent stray @@x" };
            isStreamingDisplay = true;
            linePrefixBuffer = "";
            currentSentence = "";
            emitted = 0;
          } else if (linePrefixBuffer.length >= 3 && !linePrefixBuffer.startsWith("@")) {
            // Line does not start with protocol tag delimiter; treat as display text.
            // The delta for it comes from the streaming branch above, after the canary check.
            isStreamingDisplay = true;
            currentSentence = linePrefixBuffer;
            emitted = 0;
            linePrefixBuffer = "";
          } else if (
            linePrefixBuffer.length >= 4 &&
            linePrefixBuffer.startsWith("@") &&
            !linePrefixBuffer.startsWith("@@")
          ) {
            // Single @ prefix without double @@; treat as display text
            isStreamingDisplay = true;
            currentSentence = linePrefixBuffer;
            emitted = 0;
            linePrefixBuffer = "";
          }
        }
      }
    }
  }

  // Handle stream completion
  if (!hasEnded) {
    if (isStreamingDisplay && currentSentence.trim()) {
      const text = currentSentence.trim();
      if (canaryTripped || (opts.canary && containsCanary(text, opts.canary))) {
        yield { type: "warning", message: "canary_leaked" };
        yield {
          type: "display.sentence",
          index: sentenceIndex++,
          text: sanitizeCanary(text, opts.canary),
        };
      } else {
        // The held back tail never got a delta of its own, so the sentence carries it.
        yield { type: "display.sentence", index: sentenceIndex++, text };
      }
    } else if (linePrefixBuffer.trim()) {
      const line = linePrefixBuffer.trim();
      const events = handleLine(line, opts, sentenceIndex);
      for (const ev of events) {
        yield ev;
        if (ev.type === "end") hasEnded = true;
      }
    }

    if (!hasEnded) {
      yield { type: "end" };
    }
  }
}

function handleLine(
  line: string,
  opts: ParseTurnStreamOpts,
  currentSentenceIndex: number,
): TurnEvent[] {
  const events: TurnEvent[] = [];

  if (line === "@@end") {
    events.push({ type: "end" });
    return events;
  }

  if (line.startsWith("@@g ")) {
    const jsonStr = line.slice(4).trim();
    try {
      const data = JSON.parse(jsonStr);
      events.push({ type: "verdict", data });
    } catch {
      events.push({ type: "warning", message: "Invalid JSON in @@g payload" });
    }
    return events;
  }

  if (line.startsWith("@@m ")) {
    const id = line.slice(4).trim();
    if (opts.offeredMoveIds && !opts.offeredMoveIds.has(id)) {
      events.push({ type: "warning", message: `Unknown move id: ${id}` });
    } else {
      events.push({ type: "move", id });
    }
    return events;
  }

  if (line.startsWith("@@d ")) {
    const text = line.slice(4).trim();
    events.push({ type: "display.delta", text });
    events.push({ type: "display.sentence", index: currentSentenceIndex, text });
    return events;
  }

  if (line.startsWith("@@s ")) {
    // Only llm mode asks the model for a speech line. In mirror and normalize the engine
    // derives it, so a stray @@s here would sign and queue the same sentence twice.
    if (opts.speechMode === "llm") {
      // The model wrote this line, so it gets the same treatment as a derived speech form:
      // markdown stripped and length capped before it is signed and sent to a provider.
      const text = stripMarkdown(line.slice(4).trim()).slice(0, opts.maxSpeechChars ?? 400);
      const pairedIndex = Math.max(0, currentSentenceIndex - 1);
      if (!opts.scope || !text) return events;
      const token = signSpeech(text, opts.lang || "en", opts.turnId || "", opts.scope);
      events.push({
        type: "speech.item",
        index: pairedIndex,
        text,
        lang: opts.lang,
        sig: token.sig,
        exp: token.exp,
      });
    }
    return events;
  }

  if (line.startsWith("@@f ")) {
    const ids = line
      .slice(4)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const validIds: string[] = [];
    for (const id of ids) {
      if (opts.allowedFactIds && !opts.allowedFactIds.has(id)) {
        events.push({ type: "warning", message: `Unknown fact id: ${id}` });
      } else {
        validIds.push(id);
      }
    }

    if (validIds.length > 0) {
      events.push({ type: "facts", ids: validIds });
    }
    return events;
  }

  if (line.startsWith("@@e ")) {
    const jsonStr = line.slice(4).trim();
    try {
      const data = JSON.parse(jsonStr);
      events.push({ type: "evidence", data });
    } catch {
      events.push({ type: "warning", message: "Invalid JSON in @@e payload" });
    }
    return events;
  }

  if (line.startsWith("@@x ")) {
    events.push({ type: "warning", message: "Model sent stray @@x" });
    const text = line.slice(4).trim();
    events.push({ type: "display.delta", text });
    events.push({ type: "display.sentence", index: currentSentenceIndex, text });
    return events;
  }

  // Any other line starting with @@
  if (line.startsWith("@@")) {
    events.push({ type: "warning", message: `Model sent unrecognized line: ${line}` });
    const text = line.replace(/^@@[a-zA-Z0-9_-]*\s*/, "").trim() || line;
    events.push({ type: "display.delta", text });
    events.push({ type: "display.sentence", index: currentSentenceIndex, text });
    return events;
  }

  // Untagged plain line
  events.push({ type: "display.delta", text: line });
  events.push({ type: "display.sentence", index: currentSentenceIndex, text: line });
  return events;
}
