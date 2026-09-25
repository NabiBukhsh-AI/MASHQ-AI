// Arabic-Indic (U+0660..0669) and Extended Arabic-Indic (U+06F0..06F9, used in Urdu)
// digits map to ASCII one to one, so the output has the same length and offsets
// found on the normalized text apply to the original.
const ZERO_CODES = [0x0660, 0x06f0];

export function normalizeDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const base = ZERO_CODES.find((z) => code >= z && code <= z + 9);
    out += base === undefined ? ch : String.fromCharCode(0x30 + (code - base));
  }
  return out;
}

/**
 * Renders Western digits as Extended Arabic-Indic, for orgs that set
 * `language.urduDigits` to "eastern". Western is the default because Pakistani banking
 * forms and CNIC numbers are written in Western digits.
 */
export function toEasternDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += code >= 0x30 && code <= 0x39 ? String.fromCharCode(0x06f0 + (code - 0x30)) : ch;
  }
  return out;
}

/** Applies the org digit preference to text about to be displayed. */
export function applyDigitStyle(text: string, style: "western" | "eastern"): string {
  return style === "eastern" ? toEasternDigits(text) : normalizeDigits(text);
}
