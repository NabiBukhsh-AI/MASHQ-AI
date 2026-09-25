import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FactChip } from "./FactChip";

describe("FactChip", () => {
  it("renders fact chip with label and accessible attributes", () => {
    const html = renderToStaticMarkup(
      <FactChip
        factId="f_ack_60s"
        statement="Acknowledge visitors within 60 seconds."
        onClick={() => {}}
      />,
    );

    expect(html).toContain('data-testid="fact-chip"');
    expect(html).toContain("f_ack_60s");
    expect(html).toContain("Source");
    expect(html).toContain(
      'aria-label="Show source for fact: Acknowledge visitors within 60 seconds."',
    );
  });

  it("renders fallback label when statement is not provided", () => {
    const html = renderToStaticMarkup(<FactChip factId="f_balance_req" onClick={() => {}} />);

    expect(html).toContain("f_balance_req");
    expect(html).toContain('aria-label="Show source for fact: f_balance_req"');
  });
});
