import { describe, it, expect } from "vitest";
import { signSpeech, verifySpeech, computeSpeechHmac } from "./speech-token";

describe("speech-token signing and verification", () => {
  const text = "Aap ka pehla qadam bilkul theek tha.";
  const lang = "ur";
  const turnId = "turn-01234567-89ab-cdef-0123-456789abcdef";
  const scope = {
    orgId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-0000000000a1",
    sessionId: "00000000-0000-0000-0000-0000000000b1",
  };

  it("signs speech with valid HMAC and future expiry", () => {
    const token = signSpeech(text, lang, turnId, scope, 300);
    expect(token.sig).toBeDefined();
    expect(typeof token.sig).toBe("string");
    expect(token.sig.length).toBe(64); // sha256 hex string
    expect(token.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("successfully verifies valid token", () => {
    const token = signSpeech(text, lang, turnId, scope);
    const valid = verifySpeech({ scope, text, lang, turnId, sig: token.sig, exp: token.exp });
    expect(valid).toBe(true);
  });

  it("rejects token when text has been altered", () => {
    const token = signSpeech(text, lang, turnId, scope);
    const valid = verifySpeech({
      scope,
      text: "Aap ka pehla qadam ghalat tha.",
      lang,
      turnId,
      sig: token.sig,
      exp: token.exp,
    });
    expect(valid).toBe(false);
  });

  it("rejects token when language has been altered", () => {
    const token = signSpeech(text, lang, turnId, scope);
    const valid = verifySpeech({ scope, text, lang: "en", turnId, sig: token.sig, exp: token.exp });
    expect(valid).toBe(false);
  });

  it("rejects token when turnId has been altered", () => {
    const token = signSpeech(text, lang, turnId, scope);
    const valid = verifySpeech({
      scope,
      text,
      lang,
      turnId: "different-turn-id",
      sig: token.sig,
      exp: token.exp,
    });
    expect(valid).toBe(false);
  });

  it("rejects expired token", () => {
    const token = signSpeech(text, lang, turnId, scope, 10);
    const simulatedFutureTime = token.exp + 1; // 1 second after expiration
    const valid = verifySpeech(
      { scope, text, lang, turnId, sig: token.sig, exp: token.exp },
      simulatedFutureTime,
    );
    expect(valid).toBe(false);
  });

  it("rejects missing or empty signature or exp", () => {
    expect(verifySpeech({ scope, text, lang, turnId, sig: "", exp: 123456 })).toBe(false);
    expect(verifySpeech({ scope, text, lang, turnId, sig: "abc" })).toBe(false);
    expect(verifySpeech({ scope, text: "", lang, turnId, sig: "abc", exp: 123456 })).toBe(false);
  });

  it("rejects invalid non-hex or mismatched signature format", () => {
    const valid = verifySpeech({
      scope,
      text,
      lang,
      turnId,
      sig: "not-a-valid-hex-length-signature",
      exp: Math.floor(Date.now() / 1000) + 100,
    });
    expect(valid).toBe(false);
  });

  it("produces deterministic HMAC for given parameters and secret", () => {
    const secret = "test-custom-secret-for-reproducibility-key-12345";
    const exp = 1800000000;
    const hmac1 = computeSpeechHmac(text, lang, turnId, exp, scope, secret);
    const hmac2 = computeSpeechHmac(text, lang, turnId, exp, scope, secret);
    expect(hmac1).toBe(hmac2);
    expect(hmac1.length).toBe(64);
  });
});
