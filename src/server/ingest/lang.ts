import type { Lang } from "../config/schema";

// Arabic-script share versus Latin letters, with Roman Urdu
// recognised by function words. Thresholds are heuristics tuned on the sample
// set in lang.test.ts; ponytail: swap for a model call if testing shows misfires.

const ARABIC_LETTER = /[ؠ-يٮ-ۓۺ-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u;
const LATIN_LETTER = /[A-Za-z]/;

// Function words and common verbs of Roman Urdu, lower case. Words that are also
// common English words (the, to, main) are left out on purpose.
const ROMAN_URDU = new Set(
  (
    "hai hain ka ki ke ko nahi nahin nhi aur mein kya aap raha rahi rahe tha thi se par pe " +
    "ho hoga hogi karein karen karo kar kiya karna ye yeh wo woh bhi ab tum hum apna apni apne liye " +
    "lie sath saath kyun kaise kahan kab jab tab agar magar lekin phir kuch sab bohat bahut acha " +
    "theek pehle baad wala wali walay chahiye sakta sakti sakte gaya gayi gaye hua hui hue mujhe " +
    "tumhe unhe unko usko iska iski uska uski humein hamein na toh kaun kis kisi sirf zaroor zaroori " +
    "matlab shukriya janab sahab bilkul samajh aaya aayi aaye dekho dekhein batao bataiye zara"
  ).split(" "),
);

export function detectLang(text: string): Lang {
  let arabic = 0;
  let latin = 0;
  for (const ch of text) {
    if (ARABIC_LETTER.test(ch)) arabic++;
    else if (LATIN_LETTER.test(ch)) latin++;
  }
  const total = arabic + latin;
  if (total === 0) return "en";
  const arabicShare = arabic / total;

  if (arabicShare >= 0.85) return "ur";
  if (arabicShare > 0.15) return "mixed";

  // Latin-dominant: Roman Urdu when function words are common.
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return "en";
  const hits = words.filter((w) => ROMAN_URDU.has(w)).length;
  if (hits >= 2 && hits / words.length >= 0.12) return "ur-Latn";
  return "en";
}
