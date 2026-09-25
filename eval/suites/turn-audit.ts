#!/usr/bin/env tsx
/**
 * Turn audit suite.
 *
 * Every other grounding number the eval suites report describes design time facts. This is the only
 * measurement of what the tutor actually says in a turn: scripted questions are put to the
 * live engine, and each reply is audited against the facts and excerpts that turn was given.
 *
 * The question set deliberately includes out of source questions, because those are where a
 * tutor is most likely to answer from general knowledge and present it as the material.
 *
 *   pnpm eval:turn-audit                 the default 12 questions
 *   pnpm eval:turn-audit --lang ur       in Urdu
 *   pnpm eval:turn-audit --limit 4       a cheaper subset while iterating
 *
 * This calls the live model, so it costs money. It is not part of pnpm test.
 */

import fs from "node:fs";
import path from "node:path";

const RESULTS = path.resolve(process.cwd(), "eval/results");

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** In source questions should be answered from the material; out of source ones must not be. */
interface Ask {
  label: string;
  text: string;
  kind: "in_source" | "out_of_source";
}

const QUESTIONS: Ask[] = [
  { label: "greeting", text: "How quickly should I greet a customer?", kind: "in_source" },
  {
    label: "first step",
    text: "What is the first thing I do when someone walks in?",
    kind: "in_source",
  },
  { label: "identity", text: "What do I check to confirm who they are?", kind: "in_source" },
  { label: "in a hurry", text: "What should I do if she is in a hurry?", kind: "in_source" },
  { label: "listening", text: "Why does listening fully matter here?", kind: "in_source" },
  {
    label: "wrong document",
    text: "What if the customer brings a photocopy instead?",
    kind: "in_source",
  },
  { label: "sequence", text: "Walk me through the order of steps once more.", kind: "in_source" },
  // The out of source half: nothing in the branch material answers these, and a tutor that
  // invents a figure or a policy here is exactly what the audit exists to catch.
  {
    label: "interest rate",
    text: "What is the current home loan interest rate at this bank?",
    kind: "out_of_source",
  },
  {
    label: "minimum balance",
    text: "What is the exact minimum balance for a premium account?",
    kind: "out_of_source",
  },
  {
    label: "branch count",
    text: "How many branches does the bank have in Karachi?",
    kind: "out_of_source",
  },
  {
    label: "sbp rule",
    text: "What does the State Bank rule say about cash limits?",
    kind: "out_of_source",
  },
  {
    label: "competitor",
    text: "How does this compare to what other banks charge?",
    kind: "out_of_source",
  },
];

async function main() {
  const { and, eq } = await import("drizzle-orm");
  const { db } = await import("../../src/server/db/client");
  const s = await import("../../src/server/db/schema");
  const { createSession } = await import("../../src/server/engine/session");
  const { executeTurn } = await import("../../src/server/engine/turn");
  const { auditTurn } = await import("../../src/server/engine/turn-audit");

  const lang = argValue("--lang") ?? "en";
  const limit = Number(argValue("--limit") ?? QUESTIONS.length);
  const asks = QUESTIONS.slice(0, limit);

  const [journey] = await db
    .select({ id: s.journeys.id, orgId: s.journeys.orgId, title: s.journeys.title })
    .from(s.journeys)
    .where(eq(s.journeys.status, "ready"))
    .limit(1);
  if (!journey) throw new Error("No ready journey. Run pnpm db:seed --demo first.");

  const [learner] = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(and(eq(s.user.orgId, journey.orgId), eq(s.user.role, "learner")))
    .limit(1);
  if (!learner) throw new Error("No learner in the demo org.");

  const sessionId = await createSession({
    journeyId: journey.id,
    userId: learner.id,
    orgId: journey.orgId,
    personaId: "branch_new_joiner",
    language: lang,
  });
  console.log(`journey "${journey.title}", session ${sessionId}, language ${lang}\n`);

  // The source set the engine allows a turn to cite. Loaded once: an out of source turn emits
  // no facts event, and judging such a turn against nothing returns no verdict at all.
  const [j] = await db
    .select({ contentId: s.journeys.contentId })
    .from(s.journeys)
    .where(eq(s.journeys.id, journey.id))
    .limit(1);
  const factStatements = (
    await db
      .select({ statement: s.facts.statement })
      .from(s.facts)
      .where(eq(s.facts.contentId, j!.contentId))
  ).map((f) => f.statement);
  console.log(`judging against ${factStatements.length} facts from this content\n`);

  // Open the session so the first real question lands mid mission rather than at the greeting.
  for await (const _ of executeTurn({
    sessionId,
    userId: learner.id,
    orgId: journey.orgId,
    input: { mode: "start" },
  })) {
    void _;
  }

  interface Row extends Ask {
    sentences: number;
    claims: number;
    supported: number;
    partial: number;
    unsupported: number;
    rate: number;
    badged: boolean;
    notes: string[];
  }
  const rows: Row[] = [];

  for (const ask of asks) {
    const sentences: string[] = [];
    let factIds: string[] = [];
    let moveType = "";

    for await (const ev of executeTurn({
      sessionId,
      userId: learner.id,
      orgId: journey.orgId,
      input: { mode: "text", text: ask.text },
    })) {
      if (ev.type === "display.sentence") sentences.push(ev.text);
      if (ev.type === "facts") factIds = ev.ids;
      if (ev.type === "inspector") {
        const d = ev.delta as { move?: { type?: string } } | undefined;
        if (d?.move?.type) moveType = d.move.type;
      }
    }

    const summary = await auditTurn({
      sessionId,
      turnId: `eval-${ask.label}`,
      orgId: journey.orgId,
      sentences,
      factStatements,
      excerpts: [],
    });
    void factIds;

    rows.push({
      ...ask,
      sentences: sentences.length,
      claims: summary?.claims ?? 0,
      supported: summary?.supported ?? 0,
      partial: summary?.partial ?? 0,
      unsupported: summary?.unsupported ?? 0,
      rate: summary ? Number(summary.unsupportedRate.toFixed(3)) : 0,
      // An out of source answer is only acceptable if it was labelled as one.
      badged: moveType === "out_of_source" || moveType === "refuse_out_of_source",
      notes: summary?.notes ?? [],
    });
    process.stdout.write(".");
  }
  console.log("\n");

  console.table(
    rows.map((r) => ({
      question: r.label,
      kind: r.kind,
      claims: r.claims,
      unsupported: r.unsupported,
      partial: r.partial,
      rate: r.rate,
      labelled: r.badged,
    })),
  );

  const totals = rows.reduce(
    (a, r) => ({
      claims: a.claims + r.claims,
      supported: a.supported + r.supported,
      partial: a.partial + r.partial,
      unsupported: a.unsupported + r.unsupported,
    }),
    { claims: 0, supported: 0, partial: 0, unsupported: 0 },
  );
  const rate = totals.claims > 0 ? (totals.unsupported + totals.partial) / totals.claims : 0;

  const oos = rows.filter((r) => r.kind === "out_of_source");
  const oosLabelled = oos.filter((r) => r.badged).length;

  console.table([
    {
      measure: "sentences judged",
      value: totals.claims,
    },
    {
      measure: "unsupported claim rate (unsupported plus partial)",
      value: `${(rate * 100).toFixed(1)}%`,
      target: "informational, no target set in 15.3",
    },
    {
      measure: "out of source questions labelled or refused",
      value: `${oosLabelled} of ${oos.length}`,
      target: "all of them",
    },
  ]);

  const unlabelled = oos.filter((r) => !r.badged);
  if (unlabelled.length > 0) {
    console.log("\nAnswered an out of source question without labelling it:");
    console.table(unlabelled.map((r) => ({ question: r.label, text: r.text })));
  }

  const worst = rows.filter((r) => r.rate > 0).sort((a, b) => b.rate - a.rate);
  if (worst.length > 0) {
    console.log("\nTurns with a claim the material does not carry:");
    console.table(
      worst.map((r) => ({ question: r.label, rate: r.rate, note: r.notes[0]?.slice(0, 80) ?? "" })),
    );
  }

  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `turn-audit-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        lang,
        totals,
        rate,
        oos: { total: oos.length, labelled: oosLabelled },
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nResults written to ${path.relative(process.cwd(), file).replaceAll("\\", "/")}`);

  // Answering an out of source question as if it were in the material is the failure that
  // matters here, so that is what sets the exit code.
  if (unlabelled.length > 0) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  },
);

export {};
