#!/usr/bin/env tsx
// Applies drizzle/views.sql. The file drops and recreates every view, so
// it is safe to run repeatedly: that is how a view change ships.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");

  const file = resolve(process.cwd(), "drizzle/views.sql");
  const text = readFileSync(file, "utf8");

  // Neon HTTP runs one statement per request. Comment lines are dropped first so a semicolon
  // inside a comment cannot split a statement in half.
  const statements = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let applied = 0;
  for (const statement of statements) {
    try {
      await db.execute(sql.raw(statement));
      applied += 1;
    } catch (err) {
      // Name the statement that failed: a silent partial apply is how you end up with one view.
      const head = statement.split(/\r?\n/)[0] ?? statement.slice(0, 60);
      console.error(`failed: ${head}`);
      throw err;
    }
  }
  console.log(`applied ${applied} statements from drizzle/views.sql`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
