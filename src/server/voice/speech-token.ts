import crypto from "node:crypto";
import { env } from "@/env";

export interface SpeechTokenPayload {
  sig: string;
  exp: number;
}

/**
 * Who a speech token was minted for. Signing it in means a token lifted from one learner's
 * session cannot be replayed by another learner, another org, or against another session.
 */
export interface SpeechScope {
  orgId: string;
  userId: string;
  sessionId: string;
}

export interface VerifySpeechParams {
  text: string;
  lang?: string;
  turnId?: string;
  sig?: string;
  exp?: number;
  scope: SpeechScope;
}

function getSigningSecret(): string {
  // No fallback: a shared or committed secret would let anyone mint speech tokens.
  const secret = env.SPEECH_SIGNING_SECRET;
  if (!secret) {
    throw new Error("SPEECH_SIGNING_SECRET is not configured.");
  }
  return secret;
}

/**
 * Computes an HMAC SHA-256 signature over the text, its language, the turn, the expiry and the
 * scope. The payload is JSON encoded so no field can be shifted into its neighbour.
 */
export function computeSpeechHmac(
  text: string,
  lang: string,
  turnId: string,
  exp: number,
  scope: SpeechScope,
  secret: string = getSigningSecret(),
): string {
  const payload = JSON.stringify([
    text,
    lang,
    turnId,
    exp,
    scope.orgId,
    scope.userId,
    scope.sessionId,
  ]);
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Generates an HMAC signature and expiry for engine-produced speech sentences.
 * The TTL only has to outlive the playback queue for one turn.
 */
export function signSpeech(
  text: string,
  lang: string = "en",
  turnId: string = "",
  scope: SpeechScope,
  ttlSeconds: number = 120,
): SpeechTokenPayload {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = computeSpeechHmac(text, lang, turnId, exp, scope);
  return { sig, exp };
}

/**
 * Verifies that a speech synthesis request corresponds to authentic, unexpired engine text
 * minted for this caller. The scope is re-derived server side, never taken from the request.
 */
export function verifySpeech(
  params: VerifySpeechParams,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const { text, lang = "", turnId = "", sig, exp, scope } = params;
  if (!sig || typeof exp !== "number" || !text) {
    return false;
  }
  if (nowSeconds > exp) {
    return false;
  }
  try {
    const expectedHmac = computeSpeechHmac(text, lang, turnId, exp, scope);
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedHmac, "hex");
    if (sigBuf.length !== expectedBuf.length || sigBuf.length === 0) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}
