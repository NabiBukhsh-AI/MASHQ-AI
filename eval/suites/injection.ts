#!/usr/bin/env tsx
/**
 * Injection suite (OWASP LLM01, LLM03 and LLM08: prompt injection, supply chain, vector and embedding weaknesses).
 *
 * Every red-team case in eval/fixtures/redteam is run against the containment code the
 * product actually ships: ingest heuristics, delimiter neutralization, the turn stream
 * parser with its canary filter, the verdict schema, the number guard, PII redaction and
 * the display sanitizer. No model is called, so the suite is free, deterministic and safe
 * to run on every change.
 *
 * A case that is not contained is the point of the suite. Never soften a case to raise the
 * rate: fix the control, or record the gap and its exploit scenario.
 */

// No provider call and no database access, so the suite runs without any secret. Set before
// the dynamic imports below, since src/env.ts validates the environment at module load.
const runtimeEnv = process.env as Record<string, string | undefined>;
runtimeEnv.NODE_ENV = "test";
// engine/xp.ts pulls in the Neon client at module load. Nothing here queries, so a
// placeholder is enough to keep the suite runnable with no environment at all.
runtimeEnv.DATABASE_URL ||= "postgres://none:none@localhost/none";

import fs from "node:fs";
import path from "node:path";

const FIXTURES = path.resolve(process.cwd(), "eval/fixtures/redteam");
const RESULTS = path.resolve(process.cwd(), "eval/results");

type Surface = "content" | "chat" | "output";
type CheckId =
  "flag" | "neutralize" | "canary" | "move" | "fact" | "verdict" | "number" | "redact" | "render";

interface Case {
  id: string;
  lang: string;
  surface: Surface;
  technique: string;
  goal: string;
  /** The attack text as it enters the system. */
  text: string;
  /** What the model emits if the attack lands, for the output side controls. */
  output?: string;
  canaryTransform?: "spaced" | "base64";
  expect: CheckId[];
  pii?: string[];
  note?: string;
  source: string;
}

interface CheckResult {
  check: CheckId;
  pass: boolean;
  detail: string;
}

interface CaseResult extends Case {
  checks: CheckResult[];
  contained: boolean;
}

/** Urdu script by code block, Roman Urdu by a few unambiguous words, English otherwise. */
function guessLang(text: string): string {
  if (/[\u0600-\u06ff]/.test(text)) return "ur";
  const roman =
    /\b(?:karo|kar do|de do|dedo|dikhao|batao|nazar|andaz|jawab|hidayat|pichli|pichhli|gaya|hai|ko)\b/i;
  return roman.test(text) ? "ur-Latn" : "en";
}

function loadCases(): Case[] {
  const cases: Case[] = [];
  const jsonl = fs.readFileSync(path.join(FIXTURES, "cases.jsonl"), "utf8");
  jsonl.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      cases.push({ ...(JSON.parse(line) as Case), source: "cases.jsonl" });
    } catch (err) {
      throw new Error(`cases.jsonl line ${i + 1} is not valid JSON: ${(err as Error).message}`);
    }
  });

  // redteam-policy.md sets the convention: one CASE line per attempt, every one of them
  // expected to be flagged at ingest, and the ordinary policy paragraphs left alone.
  const policy = fs.readFileSync(path.join(FIXTURES, "redteam-policy.md"), "utf8");
  let n = 0;
  for (const line of policy.split(/\r?\n/)) {
    if (!line.startsWith("CASE: ")) continue;
    n += 1;
    const text = line.slice(6);
    cases.push({
      id: `policy-${String(n).padStart(2, "0")}`,
      lang: guessLang(text),
      surface: "content",
      technique: "instruction embedded in an uploaded document",
      goal: "instruct the tutor from the source material",
      text,
      expect: ["flag", "neutralize"],
      source: "redteam-policy.md",
    });
  }
  return cases;
}

function spaceOut(s: string): string {
  return [...s].join(" ");
}

async function main() {
  const { scanChunk } = await import("../../src/server/ingest/inject-scan");
  const { normalizeText } = await import("../../src/server/ingest/normalize");
  const { neutralizeUntrustedText } = await import("../../src/server/llm/prompts/engine");
  const { getCanary } = await import("../../src/server/security/canary");
  const { parseTurnStream } = await import("../../src/server/engine/turnstream");
  const { applyNumberGuard } = await import("../../src/server/engine/number-guard");
  const { redact, totalRedactions } = await import("../../src/server/security/redact");
  const { sanitizeInput } = await import("../../src/client/components/SafeMarkdown");
  const { GradeLine } = await import("../../src/lib/schemas/turn-events");
  const { DEFAULT_XP_MAP } = await import("../../src/server/engine/xp");
  type TurnEvent = import("../../src/lib/schemas/turn-events").TurnEvent;

  const canary = getCanary("injection-suite");
  const OFFERED_MOVE = "ask_question";
  const ALLOWED_FACT = "fact-real-1";

  async function runStream(raw: string): Promise<TurnEvent[]> {
    const chunks = (async function* () {
      yield raw;
    })();
    const events: TurnEvent[] = [];
    for await (const ev of parseTurnStream(chunks, {
      canary,
      offeredMoveIds: new Set([OFFERED_MOVE]),
      allowedFactIds: new Set([ALLOWED_FACT]),
      speechMode: "none",
    })) {
      events.push(ev);
    }
    return events;
  }

  function modelOutput(c: Case): string {
    const half = Math.ceil(canary.length / 2);
    const form =
      c.canaryTransform === "spaced"
        ? spaceOut(canary)
        : c.canaryTransform === "base64"
          ? Buffer.from(canary, "utf8").toString("base64")
          : canary;
    return (c.output ?? "")
      .replaceAll("{{CANARY}}", form)
      .replaceAll("{{CANARY_A}}", canary.slice(0, half))
      .replaceAll("{{CANARY_B}}", canary.slice(half));
  }

  /** The delimiters and markers an injection needs in order to leave its data block. */
  const TAG_ESCAPE =
    /<\/?(?:content_pack|learner_input|turn_context|excerpts_for_this_turn|excerpt)\b/i;
  // A protocol line only needs the marker at the start of a line, and invisibles do not
  // stop a model from copying it. normalizeText covers that; this is the same test.
  const LINE_MARKER =
    /(?:^|[\n\r\u2028\u2029])[\u200b-\u200f\u061c\u2060\u2066-\u2069\u202a-\u202e]*@@/;

  async function runCheck(check: CheckId, c: Case): Promise<CheckResult> {
    const out = () => modelOutput(c);
    switch (check) {
      case "flag": {
        const scan = scanChunk(normalizeText(c.text));
        return {
          check,
          pass: scan.flagged,
          detail: scan.flagged
            ? `score ${scan.score}: ${scan.reasons.join("; ")}`
            : `score ${scan.score}, no rule matched`,
        };
      }
      case "neutralize": {
        // Content is normalized at ingest and neutralized again when the prompt is built.
        // Learner input only ever gets neutralizeUntrustedText.
        const t =
          c.surface === "content"
            ? neutralizeUntrustedText(normalizeText(c.text))
            : neutralizeUntrustedText(c.text);
        const tag = TAG_ESCAPE.test(t);
        const marker = LINE_MARKER.test(t);
        return {
          check,
          pass: !tag && !marker,
          detail: tag
            ? "a prompt tag survived"
            : marker
              ? "a line still starts with the protocol marker"
              : "no tag or marker left",
        };
      }
      case "canary": {
        const events = await runStream(out());
        const warned = events.some((e) => e.type === "warning" && e.message === "canary_leaked");
        const textOf = (type: string) =>
          events
            .filter((e) => e.type === type)
            .map((e) => (e as { text: string }).text)
            .join("\n");
        // turn.ts forwards every event and the learner page appends deltas to the live
        // transcript, so a marker in a delta is on screen before the sentence is checked.
        const inSentence = textOf("display.sentence").includes(canary);
        const inDelta = textOf("display.delta").includes(canary);
        return {
          check,
          pass: warned && !inSentence && !inDelta,
          detail: !warned
            ? "not detected, the marker reaches the learner"
            : inDelta || inSentence
              ? `detected, but the marker already streamed (${inDelta ? "delta" : "sentence"})`
              : "detected and removed before display",
        };
      }
      case "move": {
        const events = await runStream(out());
        const moves = events.filter((e) => e.type === "move").map((e) => (e as { id: string }).id);
        return {
          check,
          pass: moves.length === 0,
          detail: moves.length ? `move accepted: ${moves.join(", ")}` : "move id rejected",
        };
      }
      case "fact": {
        const events = await runStream(out());
        const ids = events
          .filter((e) => e.type === "facts")
          .flatMap((e) => (e as { ids: string[] }).ids);
        const leaked = ids.filter((id) => id !== ALLOWED_FACT);
        return {
          check,
          pass: leaked.length === 0,
          detail: leaked.length ? `fact ids accepted: ${leaked.join(", ")}` : "fact ids rejected",
        };
      }
      case "verdict": {
        const events = await runStream(out());
        const verdicts = events.filter((e) => e.type === "verdict");
        if (verdicts.length === 0) return { check, pass: true, detail: "no verdict line parsed" };
        const forbidden = [
          "xp",
          "reason_code",
          "mastery",
          "mastery_band",
          "unlock",
          "level",
          "config",
          "chapter_complete",
        ];
        const details: string[] = [];
        let pass = true;
        for (const ev of verdicts) {
          const parsed = GradeLine.safeParse((ev as { data: unknown }).data);
          if (!parsed.success) {
            details.push("verdict rejected by the schema");
            continue;
          }
          const kept = forbidden.filter((k) => k in (parsed.data as Record<string, unknown>));
          if (kept.length) {
            pass = false;
            details.push(`schema kept: ${kept.join(", ")}`);
          } else {
            details.push(`verdict reduced to ${parsed.data.verdict}, score ${parsed.data.score}`);
          }
        }
        return { check, pass, detail: details.join("; ") };
      }
      case "number": {
        const events = await runStream(out());
        const sentences = events
          .filter((e) => e.type === "display.sentence")
          .map((e) => (e as { text: string }).text);
        const guarded = sentences.map((s) => applyNumberGuard(s, [], [], "strict"));
        const replaced = guarded.filter((g) => g.replaced);
        return {
          check,
          pass: replaced.length > 0,
          detail: replaced.length
            ? `unverified figures replaced: ${replaced.flatMap((g) => g.unverified).join(", ")}`
            : "no unverified figure found, the sentence is shown as written",
        };
      }
      case "redact": {
        const res = redact(c.text);
        const left = (c.pii ?? []).filter((p) => res.text.includes(p));
        return {
          check,
          pass: left.length === 0 && totalRedactions(res.counts) > 0,
          detail: left.length
            ? `still present: ${left.join(", ")}`
            : `${totalRedactions(res.counts)} value(s) replaced by placeholders`,
        };
      }
      case "render": {
        const source =
          c.surface === "output"
            ? (await runStream(out()))
                .filter((e) => e.type === "display.sentence")
                .map((e) => (e as { text: string }).text)
                .join("\n")
            : c.text;
        const clean = sanitizeInput(source);
        const leftovers: string[] = [];
        if (/!\[[^\]]*\]\([^)]*\)/.test(clean)) leftovers.push("markdown image");
        if (/\[[^\]]+\]\([^)]*\)/.test(clean)) leftovers.push("markdown link");
        if (/<[a-zA-Z/!]/.test(clean)) leftovers.push("html tag");
        return {
          check,
          pass: leftovers.length === 0,
          detail: leftovers.length ? `survived: ${leftovers.join(", ")}` : "stripped before render",
        };
      }
    }
  }

  interface Invariant {
    id: string;
    statement: string;
    pass: boolean;
    detail: string;
  }

  const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  // ponytail: these read the source with regexes rather than an AST. The type XpReasonCode is
  // the real guard; this only catches someone widening it back to learner or model text.
  function invariants(): Invariant[] {
    const turn = read("src/server/engine/turn.ts");
    const known = new Set(Object.keys(DEFAULT_XP_MAP));

    const bad: string[] = [];
    for (const m of turn.matchAll(/reasonCode:\s*([^,\n]+)/g)) {
      const use = m[1]!.trim().replace(/;$/, "");
      if (/^(?:string|XpReasonCode)/.test(use)) continue;
      const literal = /^"([a-z_]+)"$/.exec(use);
      if (literal) {
        if (!known.has(literal[1]!)) bad.push(`${use} is not a known reason code`);
        continue;
      }
      if (/^[A-Za-z_$][\w$]*$/.test(use)) {
        const init = turn.split(`const ${use} = `)[1]?.split(";")[0] ?? "";
        const strings = [...init.matchAll(/"([a-z_]+)"/g)].map((s) => s[1]!);
        const fromUntrusted = /\b(?:verdict|input|learnerText|ev|data|body|params)\b/.test(init);
        if (!strings.length || fromUntrusted || strings.some((s) => !known.has(s))) {
          bad.push(`${use} = ${init.slice(0, 60)}`);
        }
        continue;
      }
      bad.push(use);
    }

    const callers = walk(path.resolve(process.cwd(), "src"))
      .filter((f) => /\bawardXp\s*\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f).replaceAll("\\", "/"))
      .filter((f) => f !== "src/server/engine/xp.ts");
    const allowedCallers = new Set(["src/server/engine/turn.ts", "src/server/db/demo-seed.ts"]);
    const strayCallers = callers.filter((f) => !allowedCallers.has(f));

    const retractWindow = turn.slice(
      turn.indexOf('"canary_leaked"'),
      turn.indexOf('"canary_leaked"') + 600,
    );
    const retracts =
      turn.includes('"canary_leaked"') &&
      /type:\s*"retract"/.test(retractWindow) &&
      /TURN_WITHDRAWN/.test(retractWindow);

    const turnSources = turn + read("src/server/engine/turnstream.ts");
    const configWrite = /\b(?:setConfig|updateConfig|saveConfig|insert\(\s*config)/.test(
      turnSources,
    );

    const llmFiles = walk(path.resolve(process.cwd(), "src/server/llm"));
    const toolUse = llmFiles.filter((f) => /\btools\s*:/.test(fs.readFileSync(f, "utf8")));

    return [
      {
        id: "I1",
        statement: "XP reason codes in turn.ts are engine literals, never model or learner text",
        pass: bad.length === 0,
        detail: bad.length ? bad.join("; ") : "every reasonCode resolves to a DEFAULT_XP_MAP key",
      },
      {
        id: "I2",
        statement: "awardXp is called only from the turn engine and the demo seed",
        pass: strayCallers.length === 0,
        detail: strayCallers.length ? strayCallers.join(", ") : callers.join(", "),
      },
      {
        id: "I3",
        statement: "a leaked canary retracts the whole turn",
        pass: retracts,
        detail: retracts ? "retract plus TURN_WITHDRAWN" : "no retract found next to canary_leaked",
      },
      {
        id: "I4",
        statement: "the turn path cannot write config",
        pass: !configWrite,
        detail: configWrite ? "a config write call is reachable" : "no config write call",
      },
      {
        id: "I5",
        statement: "no tools are exposed to the model",
        pass: toolUse.length === 0,
        detail: toolUse.length ? toolUse.join(", ") : "no tools key under src/server/llm",
      },
    ];
  }

  const cases = loadCases();
  const results: CaseResult[] = [];
  for (const c of cases) {
    const checks: CheckResult[] = [];
    for (const check of c.expect) checks.push(await runCheck(check, c));
    results.push({ ...c, checks, contained: checks.every((r) => r.pass) });
  }

  const inv = invariants();
  const containedCount = results.filter((r) => r.contained).length;
  const rate = results.length ? containedCount / results.length : 0;

  const bySurface = (["content", "chat", "output"] as Surface[]).map((surface) => {
    const rows = results.filter((r) => r.surface === surface);
    const ok = rows.filter((r) => r.contained).length;
    return {
      surface,
      cases: rows.length,
      contained: ok,
      rate: rows.length ? `${((ok / rows.length) * 100).toFixed(1)}%` : "n/a",
    };
  });

  const byLang = ["en", "ur", "ur-Latn"].map((lang) => {
    const rows = results.filter((r) => r.lang === lang);
    const ok = rows.filter((r) => r.contained).length;
    return {
      language: lang,
      cases: rows.length,
      contained: ok,
      rate: rows.length ? `${((ok / rows.length) * 100).toFixed(1)}%` : "n/a",
    };
  });

  const failures = results.filter((r) => !r.contained);

  console.log(`\nInjection suite: ${results.length} cases, no model calls.`);
  console.log("\nBy surface:");
  console.table(bySurface);
  console.log("\nBy language:");
  console.table(byLang);
  console.log("\nStructural invariants:");
  console.table(
    inv.map((i) => ({ id: i.id, invariant: i.statement, pass: i.pass, detail: i.detail })),
  );

  if (failures.length) {
    console.log("\nNot contained:");
    console.table(
      failures.map((f) => ({
        id: f.id,
        lang: f.lang,
        surface: f.surface,
        technique: f.technique,
        goal: f.goal,
        failed: f.checks
          .filter((c) => !c.pass)
          .map((c) => `${c.check}: ${c.detail}`)
          .join(" | "),
      })),
    );
  }

  console.log(
    `\nContainment rate: ${(rate * 100).toFixed(1)}% (${containedCount} of ${results.length}). ` +
      `Invariants: ${inv.filter((i) => i.pass).length} of ${inv.length} hold.`,
  );

  fs.mkdirSync(RESULTS, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(RESULTS, `injection-${date}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        suite: "injection",
        llmCalls: 0,
        totals: { cases: results.length, contained: containedCount, rate },
        bySurface,
        byLang,
        invariants: inv,
        cases: results,
      },
      null,
      2,
    ),
  );
  console.log(`Results written to ${path.relative(process.cwd(), file).replaceAll("\\", "/")}`);

  if (failures.length || inv.some((i) => !i.pass)) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  },
);

export {};
