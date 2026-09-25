import crypto from "crypto";

export const DEFAULT_CANARY_PREFIX = "CANARY_MASHQ_SEC";

const REDACTED = "[REDACTED_CANARY]";

/**
 * Returns a secure canary token unique to the deployment or session.
 * Used in system prompts to detect and prevent prompt exfiltration.
 */
export function getCanary(deploymentId: string = "dev"): string {
  const hash = crypto.createHash("sha256").update(deploymentId).digest("hex").slice(0, 16);
  return `${DEFAULT_CANARY_PREFIX}_${hash}`;
}

/** Alphanumerics only, upper case: undoes spacing, punctuation, zero widths and line breaks. */
function fold(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

/**
 * A run of this many canary characters is specific enough that no ordinary reply produces
 * it: the prefix is a made up word, and twelve hex characters are 2^48 apart. Half the
 * canary is longer than this, so splitting it over two lines does not get past the check.
 */
const MIN_RUN = 12;

/** The encodings a model reaches for when asked to disguise a string. */
function encodedForms(canary: string): string[] {
  const b64 = Buffer.from(canary, "utf8").toString("base64").replace(/=+$/, "");
  return [
    b64,
    b64.replaceAll("+", "-").replaceAll("/", "_"),
    Buffer.from(canary, "utf8").toString("hex"),
  ];
}

/**
 * Checks whether the text contains the canary token, including the forms a model produces
 * when it is asked to print the marker without printing the marker: spaced out, punctuated,
 * split over lines, or encoded.
 */
export function containsCanary(text: string, canary?: string): boolean {
  if (!text || !canary) return false;
  if (text.includes(canary)) return true;

  const folded = fold(text);
  const needle = fold(canary);
  for (let i = 0; i + MIN_RUN <= needle.length; i++) {
    if (folded.includes(needle.slice(i, i + MIN_RUN))) return true;
  }
  return encodedForms(canary).some((form) => folded.includes(fold(form)));
}

/**
 * Sanitizes output by stripping or redacting the canary token if leaked.
 */
export function sanitizeCanary(text: string, canary?: string): string {
  if (!text || !canary) return text;
  const plain = text.replaceAll(canary, REDACTED);
  if (!containsCanary(plain, canary)) return plain;
  // An obfuscated form has no reliable start and end to cut out, and a reply that smuggled
  // the marker past a verbatim check is not worth showing, so none of it is shown.
  return REDACTED;
}

/**
 * How many trailing characters of a partial stream could still grow into the canary.
 *
 * A streaming display cannot un-send a delta, so the tail that is still ambiguous is held
 * back until the next chunk decides it. Ordinary text ends on a canary prefix for at most a
 * character or two, so this costs nothing that a learner can see.
 */
export function canaryTailLength(text: string, canary?: string): number {
  if (!text || !canary) return 0;
  const max = Math.min(canary.length - 1, text.length);
  for (let n = max; n > 0; n--) {
    if (canary.startsWith(text.slice(text.length - n))) return n;
  }
  return 0;
}
