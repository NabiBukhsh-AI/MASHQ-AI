#!/usr/bin/env tsx
/**
 * Measures turn latency against a deployed instance against the latency targets.
 *
 * The existing turn:live script runs the engine in this process, so it measures the engine but
 * not the deployed function, the network or the cold start. This signs in to a real deployment
 * and measures what a learner's browser would see: time from sending a turn to the first
 * display token arriving on the wire.
 *
 *   pnpm latency:live --url https://<your-app>.vercel.app --turns 6
 */

interface TurnResult {
  label: string;
  ttftMs: number | null;
  totalMs: number;
  status: number;
  sentences: number;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)]!);
}

async function main() {
  const base = argValue("--url") ?? process.env.EVAL_BASE_URL;
  if (!base) throw new Error("Give a deployment: pnpm latency:live --url https://<app>");
  // Captured after the guard: TypeScript cannot narrow across the closure below.
  const origin: string = base;
  const wanted = Number(argValue("--turns") ?? 6);

  const email = process.env.DEMO_LEARNER_EMAIL;
  const password = process.env.DEMO_LEARNER_PASSWORD;
  if (!email || !password) {
    throw new Error("DEMO_LEARNER_EMAIL and DEMO_LEARNER_PASSWORD must be set");
  }

  // Better Auth sets an httpOnly cookie; keep it by hand since fetch has no jar.
  let cookie = "";
  const remember = (res: Response) => {
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(";")[0];
      if (pair) cookie = cookie ? `${cookie}; ${pair}` : pair;
    }
  };

  const signIn = await fetch(new URL("/api/auth/sign-in/email", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
  });
  remember(signIn);
  if (!signIn.ok || !cookie) {
    throw new Error(`sign in failed: ${signIn.status}`);
  }
  console.log(`signed in to ${base}`);

  // There is no journeys list endpoint, and this script runs against the same Neon instance
  // the deployment uses, so the id comes straight from the database.
  const journeyId =
    argValue("--journey") ??
    (await (async () => {
      const { eq } = await import("drizzle-orm");
      const { db } = await import("../src/server/db/client");
      const s2 = await import("../src/server/db/schema");
      const [row] = await db
        .select({ id: s2.journeys.id })
        .from(s2.journeys)
        .where(eq(s2.journeys.status, "ready"))
        .limit(1);
      return row?.id;
    })());
  if (!journeyId) throw new Error("no ready journey found");

  const created = await fetch(new URL("/api/sessions", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: base },
    body: JSON.stringify({ journeyId, language: "en" }),
  });
  if (!created.ok) throw new Error(`could not create a session: ${created.status}`);
  const { sessionId } = (await created.json()) as { sessionId: string };
  console.log(`session ${sessionId}`);

  const results: TurnResult[] = [];

  async function turn(label: string, input: Record<string, unknown>): Promise<void> {
    const started = performance.now();
    let ttftMs: number | null = null;
    let sentences = 0;

    const res = await fetch(new URL(`/api/sessions/${sessionId}/turns`, base), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie,
        Origin: origin,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ input }),
    });

    if (!res.ok || !res.body) {
      results.push({ label, ttftMs: null, totalMs: 0, status: res.status, sentences: 0 });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // The first display delta is the moment a learner sees the tutor start to answer.
      if (ttftMs === null && buffer.includes('"display.delta"')) {
        ttftMs = Math.round(performance.now() - started);
      }
      sentences += (buffer.match(/"display\.sentence"/g) ?? []).length - sentences;
    }

    results.push({
      label,
      ttftMs,
      totalMs: Math.round(performance.now() - started),
      status: res.status,
      sentences,
    });
  }

  const script: Array<[string, Record<string, unknown>]> = [
    ["start (cold)", { mode: "start" }],
    ["wrong answer", { mode: "text", text: "I would photocopy the CNIC and start typing." }],
    ["hint", { mode: "text", text: "pata nahi, hint please" }],
    [
      "right answer",
      {
        mode: "text",
        text: "Greet her within thirty seconds, offer a seat, listen fully, then confirm.",
      },
    ],
    ["follow up", { mode: "text", text: "What should I do if she is in a hurry?" }],
    ["another", { mode: "text", text: "Thanks, that is clear." }],
  ];

  for (const [label, input] of script.slice(0, wanted)) {
    await turn(label, input);
  }

  console.table(results);

  // The SLO is about a warm instance; the first turn also pays cold start and Neon wake.
  const warm = results.filter((r) => r.ttftMs !== null).slice(1) as Array<
    TurnResult & { ttftMs: number }
  >;
  const all = results.filter((r) => r.ttftMs !== null) as Array<TurnResult & { ttftMs: number }>;

  const rows = [
    {
      measure: "first display token, all turns",
      p50: percentile(
        all.map((r) => r.ttftMs),
        50,
      ),
      p95: percentile(
        all.map((r) => r.ttftMs),
        95,
      ),
      target: "p50 1500 ms, p95 3500 ms",
    },
    {
      measure: "first display token, excluding the cold first turn",
      p50: percentile(
        warm.map((r) => r.ttftMs),
        50,
      ),
      p95: percentile(
        warm.map((r) => r.ttftMs),
        95,
      ),
      target: "p50 1500 ms, p95 3500 ms",
    },
  ];
  console.table(rows);

  const warmP50 = rows[1]!.p50;
  const warmP95 = rows[1]!.p95;
  console.log(
    `\nAgainst the targets: p50 ${warmP50} ms (target 1500), p95 ${warmP95} ms (target 3500)`,
  );
  if (warmP50 > 1500 || warmP95 > 3500) {
    console.error("first display token is outside its SLO on this deployment");
    process.exitCode = 1;
  } else {
    console.log("first display token is inside its SLO");
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

export {};
