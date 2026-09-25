import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceTab } from "./EvidenceTab";
import { MasteryTab } from "./MasteryTab";
import { RulesTab } from "./RulesTab";
import { TimingsTab } from "./TimingsTab";
import type {
  InspectorEvidence,
  InspectorMastery,
  InspectorRule,
} from "@/client/session/useInspector";

const evidence: InspectorEvidence[] = [
  {
    id: "e1",
    at: "2026-09-19T10:00:00.000Z",
    conceptKey: "c_first_minute_impact",
    signal: "choice",
    verdict: "incorrect",
    score: 0,
    credit: 0,
    weight: 0.4,
    hintLevel: 1,
    selfCorrected: false,
    misconceptionId: "m_someone_else_will_greet",
    pBefore: 0.2,
    pAfter: 0.16,
    source: "inline",
  },
];

const mastery: InspectorMastery[] = [
  {
    conceptKey: "c_first_minute_impact",
    conceptName: "The first minute decides the visit",
    p: 0.75,
    lower: 0.44,
    upper: 1,
    band: "proficient",
    nEvents: 2,
    nEff: 1.6,
    signalTypes: ["choice", "free_text"],
  },
];

const rules: InspectorRule[] = [
  {
    id: "a1",
    at: "2026-09-19T10:00:01.000Z",
    ruleId: "R07",
    moveType: "feedback_incorrect",
    modifiers: [],
    reason: "First incorrect answer on q1. Rule R07: gentle correction plus a level 1 hint.",
    source: "policy",
  },
  {
    id: "a2",
    at: "2026-09-19T10:00:02.000Z",
    ruleId: "R03",
    moveType: "switch_language",
    modifiers: ["language=ur-Latn"],
    reason: "Panel switched language to Roman Urdu; the next sentence renders in it.",
    source: "panel_control",
  },
];

describe("Inspector tabs", () => {
  it("evidence: one row per graded answer with the estimate move and no answer key", () => {
    const html = renderToStaticMarkup(<EvidenceTab rows={evidence} />);
    expect(html).toContain("c_first_minute_impact");
    expect(html).toContain("m_someone_else_will_greet");
    expect(html).toContain("0.20 to 0.16");
    expect(html).toContain("hint 1");
    expect(renderToStaticMarkup(<EvidenceTab rows={[]} />)).toContain("No evidence yet");
  });

  it("mastery: a meter with the estimate range, the band and the limited evidence note", () => {
    const html = renderToStaticMarkup(<MasteryTab rows={mastery} />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="75"');
    expect(html).toContain("range 0.44 to 1.00");
    expect(html).toContain("limited evidence");
    // every figure is labelled as an estimate
    expect(html).toContain("estimated");
  });

  it("mastery: enough evidence drops the limited note", () => {
    const html = renderToStaticMarkup(
      <MasteryTab rows={[{ ...mastery[0]!, nEvents: 4, lower: 0.7 }]} />,
    );
    expect(html).not.toContain("limited evidence");
  });

  it("rules: rule id, move, reason and the source label", () => {
    const html = renderToStaticMarkup(<RulesTab rows={rules} />);
    expect(html).toContain("R07 feedback_incorrect");
    expect(html).toContain("Rule R07: gentle correction");
    expect(html).toContain("panel");
    expect(html).toContain("modifiers: language=ur-Latn");
  });

  it("timings: tiers by default, model ids only when the server sent them", () => {
    const base = {
      turns: [
        {
          at: "t",
          ttftMs: 900,
          latencyMs: 2100,
          firstAudioMs: null,
          moveType: "feedback_incorrect",
        },
      ],
      calls: [
        {
          at: "t",
          task: "turn.respond",
          tier: "fast",
          model: null,
          ttftMs: 900,
          latencyMs: 2100,
          inputTokens: 800,
          outputTokens: 120,
          cacheReadTokens: 7600,
          costUsd: 0.0025,
        },
      ],
      totals: { costUsd: 0.0025, cacheShare: 0.9, calls: 1 },
    };
    const html = renderToStaticMarkup(<TimingsTab timings={base} />);
    expect(html).toContain("Fast tier");
    expect(html).not.toContain("claude");
    expect(html).toContain("90%");
    expect(html).toContain("900 ms");
    const withModel = renderToStaticMarkup(
      <TimingsTab
        timings={{ ...base, calls: [{ ...base.calls[0]!, model: "claude-haiku-4-5" }] }}
      />,
    );
    expect(withModel).toContain("claude-haiku-4-5");
  });
});
