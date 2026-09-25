#!/usr/bin/env tsx
// Re-apply chosen sections of the code defaults to every organization as a new audited
// config version. Run after those sections change in src/server/config/defaults.ts.
//
// Only named keys are synced, never the whole document. Two reasons:
//  - voice.tts.voices and voice.tts.routes hold provider voice ids that an admin sets by hand;
//    a wholesale sync would silently wipe them on the next run.
//  - an admin may have deliberately tuned something, and a sync should not be a reset.
//
//   pnpm db:config-sync            apply
//   pnpm db:config-sync --dry-run  show what would change and write nothing

type Section = { path: string; label: string };

/** The keys the code owns. Add one here when a default changes that orgs must pick up. */
const SYNCED: Section[] = [
  { path: "gamification.xp", label: "XP amounts" },
  { path: "gamification.levels", label: "level thresholds" },
  { path: "voice.speechMode", label: "speech channel per language" },
  { path: "voice.tts.model", label: "TTS model id" },
];

/** JSON with object keys sorted, so a difference in key order is not read as a change. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function patchFor(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  const root: Record<string, unknown> = {};
  let node = root;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) node[key] = value;
    else {
      node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
  });
  return root;
}

/**
 * llm is opt in. A stored org config can hold pricing entries for model ids the current
 * defaults no longer list, and syncing would delete them, leaving those calls costed at zero.
 * Pass --include-llm deliberately, after checking the pricing diff.
 */
const LLM_SECTION: Section = { path: "llm", label: "provider routing, tiers and pricing" };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sections = process.argv.includes("--include-llm") ? [LLM_SECTION, ...SYNCED] : SYNCED;
  const { db } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { DEFAULT_CONFIG } = await import("../src/server/config/defaults");
  const { patchOrgConfig, getOrgConfig } = await import("../src/server/config/service");

  const orgs = await db
    .select({ id: s.organizations.id, slug: s.organizations.slug })
    .from(s.organizations);

  for (const org of orgs) {
    const before = await getOrgConfig(org.id);
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    for (const section of sections) {
      const want = readPath(DEFAULT_CONFIG, section.path);
      const have = readPath(before.config, section.path);
      if (stable(want) === stable(have)) continue;

      changed.push(section.path);
      console.log(`\n${org.slug}: ${section.path} (${section.label})`);
      console.log(`  stored: ${JSON.stringify(have)}`);
      console.log(`  code  : ${JSON.stringify(want)}`);
      Object.assign(patch, deepMergeInto(patch, patchFor(section.path, want)));
    }

    if (changed.length === 0) {
      console.log(`${org.slug}: already matches the code defaults (v${before.version})`);
      continue;
    }
    if (dryRun) {
      console.log(`\n${org.slug}: would change ${changed.join(", ")} (dry run, nothing written)`);
      continue;
    }

    const result = await patchOrgConfig(
      org.id,
      null,
      patch,
      `Sync with code defaults: ${changed.join(", ")}`,
    );
    console.log(`\n${org.slug}: saved v${result.version}. ${result.summary}`);
  }
}

/** Merges one nested patch into another, so several sections become a single write. */
function deepMergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = target[key];
      target[key] = deepMergeInto(
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {},
        value as Record<string, unknown>,
      );
    } else {
      target[key] = value;
    }
  }
  return target;
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

export {};
