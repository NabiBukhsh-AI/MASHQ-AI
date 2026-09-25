/**
 * Local token estimate for chunk budgets. Latin text runs about 4 characters
 * per token; Arabic-script text tokenizes far denser (about 2 characters per
 * token on current tokenizers). Exact counts come from the provider's token
 * counting endpoint and are used only for cache-floor checks.
 */
export function isArabicScript(codePoint: number): boolean {
  return (
    (codePoint >= 0x0600 && codePoint <= 0x06ff) ||
    (codePoint >= 0x0750 && codePoint <= 0x077f) ||
    (codePoint >= 0xfb50 && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfeff)
  );
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let arabic = 0;
  let other = 0;
  for (const ch of text) {
    if (isArabicScript(ch.codePointAt(0)!)) arabic++;
    else other++;
  }
  return Math.ceil(arabic / 2 + other / 4);
}
