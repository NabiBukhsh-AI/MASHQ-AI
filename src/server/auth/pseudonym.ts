import crypto from "node:crypto";
import { env } from "@/env";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** `L-` + first 6 base32 chars of HMAC-SHA256(PSEUDONYM_SECRET, userId). */
export function pseudonymFor(userId: string, secret = env.PSEUDONYM_SECRET): string {
  if (!secret) throw new Error("PSEUDONYM_SECRET is not set");
  const digest = crypto.createHmac("sha256", secret).update(userId).digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 6) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === 6) break;
  }
  return `L-${out}`;
}
