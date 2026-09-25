#!/usr/bin/env tsx
// Fills user.pseudonym for accounts created before the auth hook existed.
// Without it the manager dashboard shows one blank row for every real learner, because it
// identifies learners only by pseudonym.

async function main() {
  const { isNull, eq } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const { user } = await import("../src/server/db/schema");
  const { pseudonymFor } = await import("../src/server/auth/pseudonym");

  const rows = await db.select({ id: user.id }).from(user).where(isNull(user.pseudonym));

  if (rows.length === 0) {
    console.log("every user already has a pseudonym");
    return;
  }

  for (const row of rows) {
    await db
      .update(user)
      .set({ pseudonym: pseudonymFor(row.id) })
      .where(eq(user.id, row.id));
  }
  console.log(`backfilled ${rows.length} pseudonyms`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

export {};
