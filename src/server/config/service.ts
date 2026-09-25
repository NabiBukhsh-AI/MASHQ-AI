import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { configAudit, configs, learningSessions } from "../db/schema";
import { getRequestId } from "../obs/request-context";
import { errors } from "../http/errors";
import { DEFAULT_CONFIG } from "./defaults";
import { diff, summarize, type PatchOp } from "./json-patch";
import { PRESETS } from "./presets";
import { deepMerge } from "./merge";
import {
  hashConfig,
  resolveConfig,
  validateConfig,
  type LearnerChoices,
  type Resolved,
} from "./resolve";
import { CONFIG_SCHEMA_VERSION, type Config, type ConfigPatch } from "./schema";

// The only way to read settings. Everything else imports from here.

export interface OrgConfig {
  config: Config;
  version: number;
  hash: string;
}

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { value: OrgConfig; expires: number }>();

/** Code defaults with the built-in presets attached: version 0 when an org has no row yet. */
export function baseConfig(): Config {
  return validateConfig({ ...DEFAULT_CONFIG, presets: PRESETS });
}

export function bustConfigCache(orgId?: string) {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

export async function getOrgConfig(orgId: string, db: Db = defaultDb): Promise<OrgConfig> {
  const hit = cache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const [row] = await db
    .select({ version: configs.version, data: configs.data })
    .from(configs)
    .where(and(eq(configs.orgId, orgId), eq(configs.isActive, true)))
    .limit(1);

  const value: OrgConfig = row
    ? {
        config: validateConfig(row.data),
        version: row.version,
        hash: hashConfig(validateConfig(row.data)),
      }
    : { config: baseConfig(), version: 0, hash: hashConfig(baseConfig()) };

  cache.set(orgId, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export interface ResolveArgs {
  orgId: string;
  contentOverride?: ConfigPatch | null;
  personaId?: string | null;
  presets?: string[];
  learnerChoices?: LearnerChoices | null;
}

/** Resolve the effective config for a session or request (defaults, org, session, learner; later wins). */
export async function resolveOrgConfig(
  args: ResolveArgs,
  db: Db = defaultDb,
): Promise<Resolved & { version: number }> {
  const org = await getOrgConfig(args.orgId, db);
  const resolved = resolveConfig({
    org: org.config,
    contentOverride: args.contentOverride,
    personaId: args.personaId,
    presets: args.presets,
    learnerChoices: args.learnerChoices,
  });
  return { ...resolved, version: org.version };
}

export interface WriteResult {
  version: number;
  patch: PatchOp[];
  summary: string;
}

/**
 * Write a new version: validate, diff against the active version, then
 * deactivate, insert and audit in one batch (one transaction on Neon HTTP). The
 * version number comes from the database, never the cache, so concurrent
 * writers collide on configs_org_version_uq instead of leaving no active row.
 */
export async function updateOrgConfig(
  orgId: string,
  actorId: string | null,
  next: unknown,
  reason: string,
  db: Db = defaultDb,
  action: "update" | "rollback" | "seed" = "update",
): Promise<WriteResult> {
  const config = validateConfig(next);
  bustConfigCache(orgId);
  const current = await getOrgConfig(orgId, db);
  const [maxRow] = await db
    .select({ max: sql<number | null>`max(${configs.version})` })
    .from(configs)
    .where(eq(configs.orgId, orgId));
  const version = Number(maxRow?.max ?? 0) + 1;
  const patch = diff(current.config, config);

  await db.batch([
    db
      .update(configs)
      .set({ isActive: false })
      .where(and(eq(configs.orgId, orgId), eq(configs.isActive, true))),
    db.insert(configs).values({
      orgId,
      version,
      data: config,
      schemaVersion: CONFIG_SCHEMA_VERSION,
      note: reason,
      createdBy: actorId,
      isActive: true,
    }),
    db.insert(configAudit).values({
      orgId,
      actorId,
      entity: "config",
      action,
      fromVersion: current.version,
      toVersion: version,
      diff: patch,
      reason,
      requestId: getRequestId(),
    }),
  ]);
  bustConfigCache(orgId);
  return { version, patch, summary: summarize(patch) };
}

/** Apply a partial change on top of the active version. */
export async function patchOrgConfig(
  orgId: string,
  actorId: string | null,
  patch: ConfigPatch,
  reason: string,
  db: Db = defaultDb,
): Promise<WriteResult> {
  const current = await getOrgConfig(orgId, db);
  return updateOrgConfig(orgId, actorId, deepMerge(current.config, patch), reason, db);
}

/** Re-activate an earlier version as a new version (history stays append-only). */
export async function rollbackConfig(
  orgId: string,
  actorId: string | null,
  toVersion: number,
  db: Db = defaultDb,
): Promise<WriteResult> {
  const [row] = await db
    .select({ data: configs.data })
    .from(configs)
    .where(and(eq(configs.orgId, orgId), eq(configs.version, toVersion)))
    .limit(1);
  if (!row) throw new Error(`Config version ${toVersion} does not exist for this organization.`);
  return updateOrgConfig(orgId, actorId, row.data, `Rollback to v${toVersion}`, db, "rollback");
}

/** Insert version 1 (the code defaults with presets) for an org that has no row yet. Idempotent. */
export async function seedOrgConfig(
  orgId: string,
  actorId: string | null,
  db: Db = defaultDb,
): Promise<number> {
  bustConfigCache(orgId);
  const current = await getOrgConfig(orgId, db);
  if (current.version > 0) return current.version;
  return (await updateOrgConfig(orgId, actorId, baseConfig(), "Seed: code defaults", db, "seed"))
    .version;
}

export async function listConfigVersions(orgId: string, db: Db = defaultDb) {
  return db
    .select({
      version: configs.version,
      note: configs.note,
      createdBy: configs.createdBy,
      createdAt: configs.createdAt,
      isActive: configs.isActive,
    })
    .from(configs)
    .where(eq(configs.orgId, orgId))
    .orderBy(desc(configs.version));
}

/** Record a preset on a running session and audit it as preset_apply. */
export async function applyPresetToSession(
  sessionId: string,
  presetId: string,
  actorId: string | null,
  db: Db = defaultDb,
): Promise<{ presets: string[] }> {
  const [session] = await db
    .select({ orgId: learningSessions.orgId, presets: learningSessions.presets })
    .from(learningSessions)
    .where(eq(learningSessions.id, sessionId))
    .limit(1);
  if (!session) throw errors.notFound("Session not found.");
  const org = await getOrgConfig(session.orgId, db);
  if (!org.config.presets[presetId])
    throw errors.badRequest(`That preset does not exist: ${presetId}.`);

  const presets = [...session.presets.filter((p) => p !== presetId), presetId];
  await db.update(learningSessions).set({ presets }).where(eq(learningSessions.id, sessionId));
  await db.insert(configAudit).values({
    orgId: session.orgId,
    actorId,
    entity: "preset",
    action: "preset_apply",
    diff: [{ op: "add", path: `/sessions/${sessionId}/presets/-`, value: presetId }],
    reason: `Preset ${presetId} applied to session`,
    requestId: getRequestId(),
  });
  return { presets };
}
