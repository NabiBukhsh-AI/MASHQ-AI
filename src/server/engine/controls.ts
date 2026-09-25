import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type Db } from "../db/client";
import { adaptationEvents, learningSessions } from "../db/schema";
import { Lang, type Config } from "../config/schema";
import { applyPresetToSession, getOrgConfig } from "../config/service";
import { errors } from "../http/errors";
import { uuidv7 } from "@/lib/ids";

// Rule R03: live session controls. A control writes the session
// row now, audits a preset, and logs an adaptation event with source panel_control. The next
// turn reads pending_switch (R03 acknowledges it) and the prompt's final message carries the
// new values, so the cached prefix is untouched.

export const SessionControlsSchema = z
  .object({
    persona: z.string().min(1).max(64).optional(),
    language: Lang.optional(),
    register: z.enum(["colleague", "formal"]).optional(),
    modality: z.enum(["text", "voice"]).optional(),
    preset: z.string().min(1).max(64).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to change." });
export type SessionControls = z.infer<typeof SessionControlsSchema>;

export type SwitchKind = "persona" | "language" | "register" | "modality" | "preset";
export interface PendingSwitch {
  /** Identifies this switch in the queue, so a turn clears exactly what it acknowledged. */
  id: string;
  kind: SwitchKind;
  to: string;
  reason: string;
}

/** Switches older than this are dropped when a new one is appended (a turn clears them anyway). */
const MAX_PENDING = 10;

/** The session-visible part of a preset patch; the rest of the patch stays config-only. */
const PresetSessionChoices = z.object({
  learner: z.object({ defaultPersonaId: z.string().optional() }).optional(),
  language: z
    .object({
      default: Lang.optional(),
      register: z.enum(["colleague", "formal"]).optional(),
    })
    .optional(),
});

const LANG_LABEL: Record<string, string> = {
  en: "English",
  ur: "Urdu",
  "ur-Latn": "Roman Urdu",
  mixed: "mixed Urdu and English",
};

/** A persona's session-visible effect, used both for a direct switch and for a preset. */
function personaSwitch(config: Config, personaId: string): PendingSwitch {
  const persona = config.personas.find((p) => p.id === personaId);
  if (!persona) throw errors.badRequest("That persona is not available in your organization.");
  return {
    id: uuidv7(),
    kind: "persona",
    to: persona.id,
    reason: `Panel switched persona to ${persona.label}: ${persona.level} level, ${persona.turnLength} turns, ${persona.register} register, difficulty ${persona.startDifficulty}.`,
  };
}

function languageSwitch(config: Config, lang: string): PendingSwitch {
  if (!config.language.enabled.includes(lang as (typeof config.language.enabled)[number]))
    throw errors.badRequest("That language is not enabled for your organization.");
  return {
    id: uuidv7(),
    kind: "language",
    to: lang,
    reason: `Panel switched language to ${LANG_LABEL[lang] ?? lang}; the next sentence renders in it.`,
  };
}

export async function applySessionControls(
  params: {
    sessionId: string;
    userId: string;
    orgId: string;
    controls: SessionControls;
    actorId: string | null;
  },
  db: Db = defaultDb,
): Promise<{ applied: PendingSwitch[]; language: string; personaId: string }> {
  const [row] = await db
    .select({
      id: learningSessions.id,
      personaId: learningSessions.personaId,
      language: learningSessions.language,
      register: learningSessions.register,
    })
    .from(learningSessions)
    .where(
      and(
        eq(learningSessions.id, params.sessionId),
        eq(learningSessions.userId, params.userId),
        eq(learningSessions.orgId, params.orgId),
      ),
    )
    .limit(1);
  if (!row) throw errors.notFound("Session not found.");
  const { config, version } = await getOrgConfig(params.orgId, db);
  const c = params.controls;
  // Unknown ids are the caller's mistake: fail with 400 before anything is written.
  if (c.preset && !config.presets[c.preset]) throw errors.badRequest("That preset does not exist.");

  const applied: PendingSwitch[] = [];
  const set: Partial<typeof learningSessions.$inferInsert> = {};

  if (c.persona) {
    const sw = personaSwitch(config, c.persona);
    set.personaId = sw.to;
    applied.push(sw);
  }
  if (c.language) {
    const sw = languageSwitch(config, c.language);
    set.language = sw.to;
    applied.push(sw);
  }
  if (c.register) {
    set.register = c.register;
    applied.push({
      id: uuidv7(),
      kind: "register",
      to: c.register,
      reason: `Panel switched register to ${c.register}.`,
    });
  }
  if (c.modality) {
    set.modality = c.modality;
    applied.push({
      id: uuidv7(),
      kind: "modality",
      to: c.modality,
      reason: `Panel switched modality to ${c.modality}.`,
    });
  }
  if (c.preset) {
    // Audited as preset_apply by the config service; the next turn resolves config with it.
    await applyPresetToSession(row.id, c.preset, params.actorId, db);
    const preset = config.presets[c.preset]!;
    applied.push({
      id: uuidv7(),
      kind: "preset",
      to: c.preset,
      reason: `Panel applied preset ${preset.label} to this session.`,
    });
    // A preset's persona, language and register are session choices, not just config defaults:
    // write them onto the session so the running turn loop actually uses them.
    const parsed = PresetSessionChoices.safeParse(preset.patch);
    const choices = parsed.success ? parsed.data : {};
    const personaId = choices.learner?.defaultPersonaId;
    if (personaId && !c.persona) {
      const sw = personaSwitch(config, personaId);
      set.personaId = sw.to;
      applied.push(sw);
    }
    const lang = choices.language?.default;
    if (lang && !c.language) {
      const sw = languageSwitch(config, lang);
      set.language = sw.to;
      applied.push(sw);
    }
    const register = choices.language?.register;
    if (register && !c.register) {
      set.register = register;
      applied.push({
        id: uuidv7(),
        kind: "register",
        to: register,
        reason: `Preset ${preset.label} sets a ${register} register.`,
      });
    }
  }

  // Appended server side and capped, so a control and a streaming turn cannot overwrite each
  // other (the turn writes `state`, never this column).
  const appended = sql`(
    select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
    from (
      select e, i from jsonb_array_elements(
        ${learningSessions.pendingSwitch} || ${JSON.stringify(applied)}::jsonb
      ) with ordinality t(e, i)
      order by i desc
      limit ${MAX_PENDING}
    ) kept
  )`;
  const statements = [
    db
      .update(learningSessions)
      .set({ ...set, pendingSwitch: appended, lastActiveAt: new Date() })
      .where(eq(learningSessions.id, row.id)),
    db.insert(adaptationEvents).values(
      applied.map((a) => ({
        id: uuidv7(),
        orgId: params.orgId,
        sessionId: row.id,
        turnId: null,
        ruleId: "R03",
        moveType: a.kind === "language" ? "switch_language" : "restyle",
        modifiers: [`${a.kind}=${a.to}`],
        params: { kind: a.kind, to: a.to },
        reason: a.reason,
        inputs: { controls: c, actorId: params.actorId },
        configVersion: version,
        source: "panel_control" as const,
      })),
    ),
  ] as const;
  await db.batch([statements[0], statements[1]]);

  return {
    applied,
    language: (set.language as string | undefined) ?? row.language,
    personaId: set.personaId ?? row.personaId,
  };
}
