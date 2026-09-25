#!/usr/bin/env tsx
// Reference data (organization, roles, badges) and the five demo accounts from
// env. Idempotent: existing accounts keep their password, roles are re-applied.

import { PERMISSIONS } from "../src/server/auth/permissions";
import { SEED_BADGES, SEED_ORG } from "../src/server/db/seed-data";

async function main() {
  const { db } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");

  const [org] = await db
    .insert(s.organizations)
    .values(SEED_ORG)
    .onConflictDoUpdate({ target: s.organizations.slug, set: { name: SEED_ORG.name } })
    .returning();
  console.log(`organization ${org!.slug} (${org!.id})`);

  for (const [id, permissions] of Object.entries(PERMISSIONS)) {
    await db
      .insert(s.roles)
      .values({ id: id as keyof typeof PERMISSIONS, permissions: [...permissions] })
      .onConflictDoUpdate({ target: s.roles.id, set: { permissions: [...permissions] } });
  }
  console.log(`roles: ${Object.keys(PERMISSIONS).join(", ")}`);

  for (const badge of SEED_BADGES) {
    await db
      .insert(s.badges)
      .values(badge)
      .onConflictDoUpdate({ target: s.badges.code, set: badge });
  }
  console.log(`badges: ${SEED_BADGES.length}`);

  const adminId = await seedAccounts(org!.id);

  const { seedOrgConfig } = await import("../src/server/config/service");
  console.log(`config version ${await seedOrgConfig(org!.id, adminId)}`);

  if (process.argv.includes("--demo")) {
    // Panel data: real engine functions over scripted answers, no LLM calls.
    const { seedDemoData } = await import("../src/server/db/demo-seed");
    const { getOrgConfig } = await import("../src/server/config/service");
    const { config } = await getOrgConfig(org!.id);
    const started = Date.now();
    const result = await seedDemoData(org!.id, config);
    console.log(
      `demo: ${result.learners} learners, ${result.sessions} sessions, ${result.evidence} evidence, ` +
        `${result.masteryRows} mastery, ${result.xpRows} xp over ${result.days} days ` +
        `in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  }
}

const ACCOUNTS = [
  { env: "DEMO_ADMIN", name: "Demo Admin", role: "admin" },
  { env: "DEMO_MANAGER", name: "Demo L&D Manager", role: "ld_manager" },
  { env: "DEMO_LEARNER", name: "Demo Learner", role: "learner" },
  { env: "DEMO_LEARNER2", name: "Demo Learner Two", role: "learner" },
  { env: "SMOKE", name: "Smoke Test", role: "learner" },
] as const;

async function seedAccounts(orgId: string): Promise<string | null> {
  let adminId: string | null = null;
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const { user } = await import("../src/server/db/schema");
  const { createAuth } = await import("../src/server/auth/auth");
  const { pseudonymFor } = await import("../src/server/auth/pseudonym");
  // Sign-up is disabled in the app; this instance allows it for seeding only.
  const auth = createAuth({ allowSignUp: true });

  for (const a of ACCOUNTS) {
    const email = process.env[`${a.env}_EMAIL`];
    const password = process.env[`${a.env}_PASSWORD`];
    if (!email || !password) {
      console.warn(`skip ${a.env}: ${a.env}_EMAIL or ${a.env}_PASSWORD not set`);
      continue;
    }
    let [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!row) {
      const created = await auth.api.signUpEmail({ body: { email, password, name: a.name } });
      row = { id: created.user.id };
    }
    await db
      .update(user)
      .set({
        orgId,
        role: a.role,
        pseudonym: pseudonymFor(row.id),
        isSeeded: true,
        emailVerified: true,
        name: a.name,
      })
      .where(eq(user.id, row.id));
    if (a.role === "admin") adminId = row.id;
    console.log(`account ${a.role}: ${email}`);
  }
  return adminId;
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
