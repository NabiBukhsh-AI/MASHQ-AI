import crypto from "node:crypto";

/**
 * UUIDv7: time-ordered, so primary keys index well and sort by creation.
 * 48-bit unix ms, 4-bit version, 12 random bits, 2-bit variant, 62 random bits.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.randomBytes(16);
  // 48-bit millisecond timestamp, big-endian (safe in a double: ms < 2^53).
  const hi = Math.floor(now / 0x1_0000_0000); // top 16 bits
  const lo = now >>> 0; // low 32 bits
  bytes[0] = (hi >>> 8) & 0xff;
  bytes[1] = hi & 0xff;
  bytes[2] = (lo >>> 24) & 0xff;
  bytes[3] = (lo >>> 16) & 0xff;
  bytes[4] = (lo >>> 8) & 0xff;
  bytes[5] = lo & 0xff;
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
