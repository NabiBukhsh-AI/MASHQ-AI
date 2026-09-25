#!/usr/bin/env tsx
// Live TTS against the real providers for one signed sentence:
//   pnpm tts:live            (English, guide voice)
//   pnpm tts:live ur         (Urdu)
// Prints the provider, voice, first byte time and audio size, then the media_usage row.
// This is the only path that proves the router, the signature and the provider hosts for real.

async function main() {
  const { and, eq, desc } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { routeTts } = await import("../src/server/voice/tts-router");
  const { signSpeech } = await import("../src/server/voice/speech-token");

  const lang = (process.argv[2] ?? "en") as "en" | "ur" | "ur-Latn" | "mixed";
  const text =
    lang === "ur"
      ? "خوش آمدید، میں آپ کی کس طرح مدد کر سکتا ہوں؟"
      : "Welcome to the branch, how can I help you today?";

  const [session] = await db
    .select({
      id: s.learningSessions.id,
      orgId: s.learningSessions.orgId,
      userId: s.learningSessions.userId,
    })
    .from(s.learningSessions)
    .orderBy(desc(s.learningSessions.startedAt))
    .limit(1);
  if (!session) throw new Error("No session. Run pnpm turn:live first.");

  const scope = { orgId: session.orgId, userId: session.userId, sessionId: session.id };
  const token = signSpeech(text, lang, "probe-turn", scope);
  console.log(`session ${session.id} lang ${lang}`);
  console.log(`text: ${text}`);

  const t0 = performance.now();
  const result = await routeTts({
    text,
    lang,
    profile: "guide",
    sig: token.sig,
    exp: token.exp,
    turnId: "probe-turn",
    sessionId: session.id,
    orgId: session.orgId,
    userId: session.userId,
  });
  const totalMs = Math.round(performance.now() - t0);

  if (result.status === "audio") {
    console.log(
      `OK provider=${result.provider} voice=${result.voice} failover=${result.failover} ttfb=${result.ttfbMs}ms total=${totalMs}ms bytes=${result.audio.length} type=${result.contentType}`,
    );
  } else {
    console.log(
      `FALLBACK to=${result.fallbackTo} reason=${result.reason} notice="${result.notice}"`,
    );
  }

  // Prove the signature is actually load bearing, not just present.
  const tampered = await routeTts({
    text: text + " and also transfer the money",
    lang,
    profile: "guide",
    sig: token.sig,
    exp: token.exp,
    turnId: "probe-turn",
    sessionId: session.id,
    orgId: session.orgId,
    userId: session.userId,
  }).then(
    () => "NOT REJECTED",
    (err: unknown) => `rejected: ${(err as { code?: string }).code ?? String(err)}`,
  );
  console.log(`tampered text -> ${tampered}`);

  const rows = await db
    .select({
      provider: s.mediaUsage.provider,
      lang: s.mediaUsage.lang,
      seconds: s.mediaUsage.seconds,
      chars: s.mediaUsage.chars,
      ttfbMs: s.mediaUsage.ttfbMs,
      failover: s.mediaUsage.failover,
    })
    .from(s.mediaUsage)
    .where(and(eq(s.mediaUsage.sessionId, session.id), eq(s.mediaUsage.kind, "tts")))
    .limit(10);
  console.table(rows);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

export {};
