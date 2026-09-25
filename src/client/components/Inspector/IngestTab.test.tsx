import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IngestTab, type IngestTelemetry } from "./IngestTab";

describe("IngestTab", () => {
  const sampleTelemetry: IngestTelemetry = {
    stages: [
      { stage: "intake", name: "Intake and parsing", status: "done", durationMs: 45 },
      {
        stage: "scan",
        name: "Prompt injection scan",
        status: "running",
        message: "Scanning chunks",
      },
      { stage: "outline", name: "Outline generation", status: "pending" },
    ],
    elapsedMs: 2450,
    redactionsCount: 2,
    injectionFlagsCount: 0,
    scannedPageCount: 0,
    warnings: ["Chunk 4 had high perplexity"],
    groundingSummary: {
      supported: 5,
      total: 6,
    },
    reused: false,
  };

  it("renders elapsed time and metrics accurately", () => {
    const html = renderToStaticMarkup(<IngestTab telemetry={sampleTelemetry} />);

    expect(html).toContain("2.5s");
    expect(html).toContain('data-testid="metric-redactions"');
    expect(html).toContain("2");
    expect(html).toContain('data-testid="metric-grounding"');
    expect(html).toContain("5/6");
  });

  it("renders pipeline stages with their current status", () => {
    const html = renderToStaticMarkup(<IngestTab telemetry={sampleTelemetry} />);

    expect(html).toContain("Intake and parsing");
    expect(html).toContain("Done (45ms)");
    expect(html).toContain("Prompt injection scan");
    expect(html).toContain("Running");
    expect(html).toContain("Scanning chunks");
    expect(html).toContain("Outline generation");
    expect(html).toContain("Waiting");
  });

  it("renders warnings list when warnings exist", () => {
    const html = renderToStaticMarkup(<IngestTab telemetry={sampleTelemetry} />);

    expect(html).toContain('data-testid="warnings-box"');
    expect(html).toContain("Chunk 4 had high perplexity");
  });

  it("renders reused badge when content was cached", () => {
    const html = renderToStaticMarkup(
      <IngestTab telemetry={{ ...sampleTelemetry, reused: true }} />,
    );

    expect(html).toContain('data-testid="reused-badge"');
    expect(html).toContain("Reused from cache");
  });
});
