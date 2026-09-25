import type { PolicySnapshot } from "./rules";

// Reason sentences are English templates filled from the snapshot.
// The Inspector shows them as written; learner-facing strings are localized elsewhere.

const q = (s: PolicySnapshot) => s.question.id;
const nth = (n: number) => (n === 1 ? "first" : n === 2 ? "second" : `${n}th`);
const mc = (s: PolicySnapshot) => (s.misconceptionId ? ` aimed at ${s.misconceptionId}` : "");
const next = (s: PolicySnapshot) =>
  s.progress.nextQuestion ? `present ${s.progress.nextQuestion.id}` : "continue the beat";

export const reasons = {
  R01: (s: PolicySnapshot) =>
    `${s.limits.spendCapReached ? "Spend cap reached" : "Session token budget exhausted"}. Rule R01: wrap up.`,
  R02: (s: PolicySnapshot) =>
    `Micro session with ${s.session.secondsLeft ?? 0} s left. Rule R02: summarize and bookmark ${q(s)}.`,
  R03: (s: PolicySnapshot) =>
    `Switch requested (${s.cues.explicitSwitch?.kind} to ${s.cues.explicitSwitch?.to}). Rule R03: acknowledge it and continue in the new style.`,
  R04in: (s: PolicySnapshot) =>
    `Learner asked a question the material covers. Rule R04: answer from the excerpts, then return to ${q(s)}.`,
  R04out: (s: PolicySnapshot, assisted: boolean) =>
    assisted
      ? `Question outside the material on ${q(s)}. Rule R04: assisted mode, one or two sentences of general context labelled as not from the material, then back to the question.`
      : `Question outside the material on ${q(s)}. Rule R04: strict mode states material does not cover it and returns to the question.`,
  R05: (s: PolicySnapshot, expert: boolean) =>
    `${s.engagement.frustratedBy === "idk_repeat" ? `"I don't know" twice in a row on ${q(s)}` : `Frustration above threshold on ${q(s)}`}. Rule R05: ${expert ? "rephrase the question plainly for an expert persona" : "encourage and simplify"}${!expert && s.mechanic.easier ? `, switch to ${s.mechanic.easier} at the next beat` : ""}.`,
  R06worked: (s: PolicySnapshot) =>
    `Incorrect answer ${s.attempts + 1} on ${q(s)}. Rule R06: show the worked example, then invite a retry.`,
  R06hint: (s: PolicySnapshot) =>
    `Incorrect again on ${q(s)} after the worked example. Rule R06: level ${Math.min(3, s.hintLevel + 1)} hint${mc(s)}.`,
  R07noHint: (s: PolicySnapshot) =>
    `First incorrect answer on ${q(s)}. Rule R07: gentle correction, no hint yet (hints.autoOfferAfterIncorrect not reached).`,
  R07: (s: PolicySnapshot) =>
    `First incorrect answer on ${q(s)}. Rule R07: gentle correction plus a level ${Math.min(3, s.hintLevel + 1)} hint${mc(s)}.`,
  R08: (s: PolicySnapshot) =>
    `Partial answer on ${q(s)} after a level ${s.hintLevel} hint. Rule R08: level ${Math.min(3, s.hintLevel + 1)} hint${s.misconceptionId ? ` aimed at ${s.misconceptionId}` : " aimed at the gap"}.`,
  R09: (s: PolicySnapshot) =>
    `${s.cues.idk ? '"I don\'t know"' : "Help requested"} on ${q(s)}. Rule R09: level ${Math.min(3, s.hintLevel + 1)} hint.`,
  R09worked: (s: PolicySnapshot) =>
    `Help requested on ${q(s)} at hint level 3. Rule R09: worked example.`,
  R10: (s: PolicySnapshot) =>
    `Correct on ${q(s)}; all ${s.progress.total} mission objectives have evidence. Rule R10: celebrate and unlock what comes next.`,
  R11: (s: PolicySnapshot, delayMinutes: number) =>
    `Correct on ${q(s)}, estimated mastery ${s.mastery?.p.toFixed(2)} (${s.mastery?.band}), answered in ${Math.round((s.latencyMs ?? 0) / 1000)} s against a ${Math.round(s.personaMedianMs / 1000)} s persona median. Rule R11: deepen with an application scenario; recall check in ${delayMinutes} minutes.`,
  R12: (s: PolicySnapshot) =>
    `A recall check is due at this beat boundary. Rule R12: retention callback before ${q(s)}.`,
  R13: (s: PolicySnapshot, offerBreak: boolean) =>
    `Fatigue above threshold (pace ${s.engagement.pace}). Rule R13: ${offerBreak ? "offer a short break" : "shorter turns"}.`,
  R14: (s: PolicySnapshot) =>
    `Learner wrote in ${s.languageDrift?.lang} for ${s.languageDrift?.turns} turns. Rule R14: switch the session language.`,
  R15: (s: PolicySnapshot) =>
    `${s.mechanic.current} used ${s.mechanic.repeats} times and ${s.mechanic.better} scores higher. Rule R15: switch mechanic at the next beat.`,
  R99correct: (s: PolicySnapshot) =>
    `Correct on ${q(s)}${s.attempts ? ` on the ${nth(s.attempts + 1)} attempt` : " first try"}. Rule R99: confirm, then ${next(s)}.`,
  R99clarify: (s: PolicySnapshot) =>
    `Input on ${q(s)} was not an answer. Rule R99: clarify what is being asked and invite an attempt.`,
};
