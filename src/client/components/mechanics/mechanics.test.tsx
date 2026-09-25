import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Mechanic, type UiPayload } from "./index";
import { pickLabel } from "./types";

const l = (en: string, ur = `${en}-ur`, urLatn = `${en}-rom`) => ({ en, ur, urLatn });

const choice: UiPayload = {
  kind: "choice",
  questionId: "q1",
  prompt: "What first?",
  options: [
    { id: "a", label: l("Greet the customer") },
    { id: "b", label: l("Start typing") },
  ],
};

describe("mechanics", () => {
  it("choice: one button per option, letters, pressed state, no answer key in the markup", () => {
    const html = renderToStaticMarkup(
      <Mechanic ui={choice} lang="en" lastAnswer="b" onAnswer={() => {}} />,
    );
    expect(html).toContain('data-testid="choice-a"');
    expect(html).toContain('data-testid="choice-b"');
    expect(html).toContain(">A<");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("correct");
    expect(html).not.toContain("consequence");
  });

  it("choice in Urdu: rtl container and Urdu labels", () => {
    const html = renderToStaticMarkup(<Mechanic ui={choice} lang="ur" onAnswer={() => {}} />);
    expect(html).toContain('dir="rtl"');
    // BidiText isolates Latin tokens inside Urdu text, so match the token, not the phrase.
    expect(html).toContain("customer-ur");
    expect(html).toContain('lang="ur"');
    expect(html).not.toContain(">Greet the customer<");
  });

  it("sequence: numbered list, move up and down buttons with labels, submit", () => {
    const ui: UiPayload = {
      kind: "sequence",
      questionId: "q2",
      prompt: "Order the steps",
      steps: [
        { id: "s1", label: l("Greet") },
        { id: "s2", label: l("Listen") },
        { id: "s3", label: l("Confirm") },
      ],
    };
    const html = renderToStaticMarkup(<Mechanic ui={ui} lang="en" onAnswer={() => {}} />);
    expect(html).toContain('data-testid="mechanic-sequence"');
    expect(html).toContain('aria-label="Move &quot;Listen&quot; up"');
    expect(html).toContain('aria-label="Move &quot;Listen&quot; down"');
    // first item cannot move up, last cannot move down (aria-disabled keeps focus after a move)
    expect(html.match(/aria-disabled="true"/g)?.length).toBe(2);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('data-testid="sequence-submit"');
    expect(html).not.toContain("correctOrder");
  });

  it("match: a labelled select per left item; rights arrive already reshuffled", () => {
    const ui: UiPayload = {
      kind: "match",
      questionId: "q3",
      prompt: "Match",
      lefts: [l("Zebra term"), l("Apple term")],
      rights: [l("Apple meaning"), l("Zebra meaning")],
    };
    const html = renderToStaticMarkup(<Mechanic ui={ui} lang="en" onAnswer={() => {}} />);
    expect(html).toContain('<label for="q3-match-0"');
    expect(html).toContain('<select id="q3-match-0"');
    expect(html.match(/<select/g)?.length).toBe(2);
  });

  it("spot the error: every sentence is a pressable button", () => {
    const ui: UiPayload = {
      kind: "spot_error",
      questionId: "q4",
      prompt: "Find the error",
      sentences: [
        { id: "t1", text: l("Ask for the CNIC.") },
        { id: "t2", text: l("Accept a photocopy.") },
      ],
    };
    const html = renderToStaticMarkup(
      <Mechanic ui={ui} lang="en" lastAnswer="t2" onAnswer={() => {}} />,
    );
    expect(html).toContain('data-testid="sentence-t1"');
    expect(html).toContain('data-testid="sentence-t2"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("errorSentenceId");
  });

  it("teach back and other open kinds render a framing card, not an input", () => {
    for (const kind of ["teach_back", "explanation", "free_text", "roleplay_turn"] as const) {
      const html = renderToStaticMarkup(
        <Mechanic
          ui={{ kind, questionId: "q5", prompt: "Explain the first minute" }}
          lang="en"
          onAnswer={() => {}}
        />,
      );
      expect(html).toContain(`data-kind="${kind}"`);
      expect(html).toContain("Explain the first minute");
      expect(html).not.toContain("<textarea");
    }
  });

  it("pickLabel falls back to English when a script is missing", () => {
    expect(pickLabel({ en: "Greet", ur: "", urLatn: "" }, "ur")).toBe("Greet");
    expect(pickLabel({ en: "Greet", ur: "", urLatn: "Salam" }, "ur-Latn")).toBe("Salam");
    expect(pickLabel("plain", "mixed")).toBe("plain");
  });
});
