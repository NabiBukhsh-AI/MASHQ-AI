import { and, eq } from "drizzle-orm";
import { env } from "@/env";
import { db as defaultDb, type Db } from "../db/client";
import { contents, glossaryTerms, journeys, learningSessions } from "../db/schema";
import { getOrgConfig } from "../config/service";
import { AppError } from "../http/errors";
import { log } from "../obs/logger";

export interface CreateSonioxTempKeyParams {
  usageType: "transcribe_websocket" | "tts_rt";
  expiresInSeconds?: number;
  singleUse?: boolean;
  maxSessionDurationSeconds?: number;
  clientReferenceId?: string;
}

export interface SonioxTempKeyResult {
  apiKey: string;
  expiresAt: string | number;
}

export interface SttContextTermsOptions {
  orgId: string;
  userId?: string;
  sessionId?: string;
  contentId?: string;
  db?: Db;
}

export interface SttSessionConfigResult {
  model: string;
  language_hints: string[];
  languageHints: string[];
  language_hints_strict: boolean;
  enable_language_identification: boolean;
  enableLanguageIdentification: boolean;
  enable_endpoint_detection: boolean;
  enableEndpointDetection: boolean;
  context: {
    terms: string[];
  };
}

/**
 * Creates a short-lived temporary API key from Soniox.
 * Keys are never logged in any output.
 */
export async function createSonioxTemporaryKey(
  params: CreateSonioxTempKeyParams,
): Promise<SonioxTempKeyResult> {
  const masterKey = env.SONIOX_API_KEY;
  if (!masterKey) {
    throw new AppError("INTERNAL_ERROR", 500, "Voice service is not configured.");
  }

  const endpoint = "https://api.soniox.com/v1/auth/temporary-api-key";
  const body = {
    usage_type: params.usageType,
    expires_in_seconds: params.expiresInSeconds ?? 60,
    single_use: params.singleUse ?? true,
    max_session_duration_seconds: params.maxSessionDurationSeconds ?? 600,
    ...(params.clientReferenceId ? { client_reference_id: params.clientReferenceId } : {}),
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${masterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      log.warn({
        event: "soniox_temp_key_http_error",
        status: res.status,
        usageType: params.usageType,
      });
      throw new AppError("INTERNAL_ERROR", 500, "Failed to issue voice key.");
    }

    const data = (await res.json()) as {
      api_key?: string;
      apiKey?: string;
      expires_at?: string;
      expiresAt?: string | number;
    };

    const apiKey = data.api_key ?? data.apiKey;
    if (!apiKey) {
      throw new AppError("INTERNAL_ERROR", 500, "Malformed voice key response from provider.");
    }

    const expiresAt =
      data.expires_at ?? data.expiresAt ?? Date.now() + (params.expiresInSeconds ?? 60) * 1000;

    log.info({
      event: "soniox_temp_key_issued",
      usageType: params.usageType,
      expiresAt,
    });

    return { apiKey, expiresAt };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    log.error({
      event: "soniox_temp_key_exception",
      usageType: params.usageType,
      message: err instanceof Error ? err.message : String(err),
    });
    throw new AppError("INTERNAL_ERROR", 500, "Could not connect to voice service.");
  }
}

/**
 * Builds the STT session configuration including model, language hints,
 * endpointing flags, and glossary context terms for the target content or session.
 */
export async function getSttSessionConfig(
  opts: SttContextTermsOptions,
): Promise<SttSessionConfigResult> {
  const db = opts.db ?? defaultDb;
  const { config } = await getOrgConfig(opts.orgId, db);

  // The session's practice language decides what the recogniser listens for.
  let targetContentId = opts.contentId;
  let sessionLang: string | undefined;
  if (opts.sessionId) {
    const [row] = await db
      .select({ contentId: journeys.contentId, language: learningSessions.language })
      .from(learningSessions)
      .innerJoin(journeys, eq(journeys.id, learningSessions.journeyId))
      .where(
        and(
          eq(learningSessions.id, opts.sessionId),
          eq(learningSessions.orgId, opts.orgId),
          ...(opts.userId ? [eq(learningSessions.userId, opts.userId)] : []),
        ),
      )
      .limit(1);

    if (row) {
      targetContentId ??= row.contentId;
      sessionLang = row.language;
    }
  }

  // An English session listens for English only, strictly. With Urdu and English both hinted,
  // English spoken with a Pakistani accent came back in Urdu script, or mixed; Soniox's own
  // docs name this case and recommend one language with language_hints_strict. Urdu and Roman
  // Urdu sessions keep both, because branch Urdu is full of English terms.
  const byLang = sessionLang ? config.voice.stt.languageHintsByLang[sessionLang] : undefined;
  const languageHints = byLang?.hints ?? config.voice.stt.languageHints;
  const strict = byLang?.strict ?? false;
  // Urdu script context terms pull a strict English session back toward Urdu script.
  const urduScript = languageHints.includes("ur");

  const terms: string[] = [];

  // Add guide character and persona names
  if (config.branding.guideCharacterName) {
    terms.push(config.branding.guideCharacterName);
  }
  for (const p of config.personas) {
    if (p.label) terms.push(p.label);
    if (p.labelUr && urduScript) terms.push(p.labelUr);
  }

  // Extract glossary terms if enabled
  if (config.voice.stt.contextFromGlossary && targetContentId) {
    const rows = await db
      .select({
        termEn: glossaryTerms.termEn,
        termUr: glossaryTerms.termUr,
        termRoman: glossaryTerms.termRoman,
      })
      .from(glossaryTerms)
      // glossary_terms has no org_id of its own; scope it through contents.
      .innerJoin(contents, eq(contents.id, glossaryTerms.contentId))
      .where(and(eq(glossaryTerms.contentId, targetContentId), eq(contents.orgId, opts.orgId)));

    for (const row of rows) {
      if (row.termEn) terms.push(row.termEn);
      if (row.termUr && urduScript) terms.push(row.termUr);
      if (row.termRoman) terms.push(row.termRoman);
    }
  }

  const uniqueTerms = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));

  const model = config.voice.stt.model;

  return {
    model,
    language_hints: languageHints,
    languageHints,
    language_hints_strict: strict,
    // Identifying the language only helps when more than one is allowed.
    enable_language_identification: !strict,
    enableLanguageIdentification: !strict,
    enable_endpoint_detection: true,
    enableEndpointDetection: true,
    context: {
      terms: uniqueTerms,
    },
  };
}
