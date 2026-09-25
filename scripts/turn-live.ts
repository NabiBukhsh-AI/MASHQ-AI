#!/usr/bin/env tsx
// Live text turns against the real fast tier on the first ready journey:
//   pnpm turn:live            (start, wrong answer, help, correct answer)
// Prints the tutor lines, verdicts, moves and timings, then the llm_calls rows.

async function main() {
  const { and, eq, sql } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { createSession } = await import("../src/server/engine/session");
  const { executeTurn } = await import("../src/server/engine/turn");

  const [journey] = await db
    .select({ id: s.journeys.id, orgId: s.journeys.orgId, title: s.journeys.title })
    .from(s.journeys)
    .where(eq(s.journeys.status, "ready"))
    .limit(1);
  if (!journey) throw new Error("No ready journey. Run pnpm pipeline:live first.");
  const [learner] = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(and(eq(s.user.orgId, journey.orgId), eq(s.user.role, "learner")))
    .limit(1);
  const sessionId = await createSession({
    journeyId: journey.id,
    userId: learner!.id,
    orgId: journey.orgId,
    personaId: "branch_new_joiner",
    language: process.argv[2] ?? "en",
  });
  const [created] = await db
    .select({ modality: s.learningSessions.modality, language: s.learningSessions.language })
    .from(s.learningSessions)
    .where(eq(s.learningSessions.id, sessionId))
    .limit(1);
  console.log(
    `journey "${journey.title}" session ${sessionId} modality=${created?.modality} lang=${created?.language}`,
  );

  const turn = async (label: string, input: Record<string, unknown>) => {
    const t0 = performance.now();
    let ttft = 0;
    const lines: string[] = [];
    let verdict = "";
    let move = "";
    let rule = "";
    let ui = "";
    const speech: string[] = [];
    for await (const ev of executeTurn({
      sessionId,
      userId: learner!.id,
      orgId: journey.orgId,
      input: input as never,
    })) {
      if (ev.type === "display.sentence") {
        if (!ttft) ttft = Math.round(performance.now() - t0);
        lines.push(ev.text);
      }
      if (ev.type === "verdict")
        verdict = JSON.stringify((ev.data as { verdict: string; score: number }).verdict);
      if (ev.type === "inspector") {
        const d = ev.delta as {
          move: { type: string; ruleId: string; reason: string };
          engagement?: { frustration: number; fatigue: number; pace: string };
          mastery?: { conceptKey: string; before: number; after: number; band: string } | null;
        };
        move = d.move.type;
        rule = `${d.move.ruleId}: ${d.move.reason}`;
        if (d.engagement)
          rule += ` | frustration ${d.engagement.frustration} fatigue ${d.engagement.fatigue} pace ${d.engagement.pace}`;
        if (d.mastery)
          rule += ` | mastery ${d.mastery.conceptKey} ${d.mastery.before.toFixed(3)} -> ${d.mastery.after.toFixed(3)} (${d.mastery.band})`;
      }
      if (ev.type === "speech.item") speech.push(`[${ev.index}] ${ev.text}`);
      if (ev.type === "ui") ui = JSON.stringify(ev.payload).slice(0, 200);
      if (ev.type === "error" || ev.type === "retract" || ev.type === "warning")
        console.log(`  ! ${ev.type} ${JSON.stringify(ev)}`);
    }
    console.log(
      `\n== ${label} (ttft ${ttft} ms, total ${Math.round(performance.now() - t0)} ms) verdict=${verdict || "n/a"} move=${move}`,
    );
    console.log(`   ${rule}`);
    for (const l of lines) console.log(`   > ${l}`);
    // The speech channel. No lines here means the session is not a voice session
    // or speechMode resolved to none, and no audio can ever play.
    for (const sp of speech) console.log(`   ~ ${sp}`);
    if (!speech.length) console.log("   ~ (no speech items)");
    if (ui) console.log(`   ui: ${ui}`);
  };

  await turn("start", { mode: "start" });
  if (process.argv[3] === "switch") {
    // A live control switch mid-session. The next turn must use the new persona and language
    // while llm_calls keeps showing cache reads (the switch lives in the final message only).
    const { applySessionControls } = await import("../src/server/engine/controls");
    await turn("wrong answer", { mode: "text", text: "I would start typing without looking up." });
    const applied = await applySessionControls({
      sessionId,
      userId: learner!.id,
      orgId: journey.orgId,
      controls: { persona: "senior_manager", language: "ur-Latn" },
      actorId: learner!.id,
    });
    for (const a of applied.applied) console.log(`  panel: ${a.reason}`);
    await turn("after switch (hello)", { mode: "text", text: "theek hai, chalein" });
    await turn("after switch (answer)", {
      mode: "text",
      text: "Customer ko tees second ke andar salam karna, phir ghaur se sunna aur confirm karna.",
    });
    await report();
    return;
  }
  if (process.argv[3] === "frustrated") {
    // R05 path: two "I don't know" replies on the same question.
    await turn("idk 1", { mode: "text", text: "pata nahi" });
    await turn("idk 2", { mode: "text", text: "mujhe nahi pata" });
    await report();
    return;
  }
  await turn("wrong answer", {
    mode: "text",
    text: "I would take a photocopy of the CNIC and start typing without looking up.",
  });
  await turn("help", { mode: "text", text: "pata nahi, hint please" });
  await turn("right answer", {
    mode: "text",
    text: "Greet the customer within thirty seconds, offer a seat, listen fully, confirm what I heard, then ask for the original CNIC.",
  });
  await turn("out of source", {
    mode: "text",
    text: "What is the interest rate on savings accounts?",
  });

  await report();

  async function report() {
    const calls = await db.execute(
      sql`select task, status, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, ttft_ms, latency_ms, error_code from llm_calls where session_id = ${sessionId} order by created_at`,
    );
    console.table(calls.rows);
    const adaptations = await db.execute(
      sql`select rule_id, move_type, modifiers, left(reason, 90) as reason from adaptation_events where session_id = ${sessionId} order by created_at`,
    );
    console.table(adaptations.rows);
    await db.delete(s.learningSessions).where(eq(s.learningSessions.id, sessionId));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });

export {};
