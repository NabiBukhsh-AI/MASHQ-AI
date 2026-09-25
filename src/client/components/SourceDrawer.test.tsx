import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceDrawer } from "./SourceDrawer";

describe("SourceDrawer", () => {
  it("renders null when closed", () => {
    const html = renderToStaticMarkup(
      <SourceDrawer open={false} onClose={() => {}} factId="f_1" />,
    );
    expect(html).toBe("");
  });

  it("renders modal dialog with fact statement, anchor, and highlighted quote", () => {
    const quote = "Visitors must be acknowledged within 60 seconds.";
    const chunkText =
      "Branch Protocol: Visitors must be acknowledged within 60 seconds. Offer water if waiting.";

    const html = renderToStaticMarkup(
      <SourceDrawer
        open={true}
        onClose={() => {}}
        factId="f_ack_60s"
        statement="Acknowledge visitors within 60 seconds."
        quote={quote}
        anchorKind="section"
        anchorRef="Greeting Standards"
        chunkText={chunkText}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-testid="source-drawer"');
    expect(html).toContain("Verified Source");
    expect(html).toContain("f_ack_60s");
    expect(html).toContain("section: Greeting Standards");
    expect(html).toContain("Acknowledge visitors within 60 seconds.");
    expect(html).toContain('data-testid="highlighted-quote"');
    expect(html).toContain(quote);
    expect(html).toContain("Offer water if waiting.");
    expect(html).toContain('aria-label="Close source drawer"');
  });

  it("shows loading state when chunk is loading", () => {
    const html = renderToStaticMarkup(
      <SourceDrawer open={true} onClose={() => {}} factId="f_1" loading={true} />,
    );

    expect(html).toContain('data-testid="source-loading"');
    expect(html).toContain("Loading source passage...");
  });
});
