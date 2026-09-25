import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JourneyMap, type JourneyChapter } from "./JourneyMap";

describe("JourneyMap", () => {
  const sampleChapters: JourneyChapter[] = [
    {
      key: "ch_counter",
      title: "Counter Customer Service",
      arcBeat: "Arrival and greeting",
      missions: [
        {
          key: "m_greeting",
          ordinal: 0,
          title: "The First Minute",
          objective: "Greet customer promptly",
          mechanic: "scenario",
          status: "ready",
        },
        {
          key: "m_verification",
          ordinal: 1,
          title: "Identity Checks",
          objective: "Verify valid CNIC",
          mechanic: "decision",
          status: "pending",
        },
      ],
    },
  ];

  it("renders journey outline with chapters and missions", () => {
    const html = renderToStaticMarkup(
      <JourneyMap
        title="Branch Care Standards"
        summary="Foundational counter skills"
        chapters={sampleChapters}
      />,
    );

    expect(html).toContain("Branch Care Standards");
    expect(html).toContain("Foundational counter skills");
    expect(html).toContain("Counter Customer Service");
    expect(html).toContain("The First Minute");
    expect(html).toContain("Identity Checks");
    expect(html).toContain("Playable");
    expect(html).toContain("Pending");
    expect(html).toContain("scenario");
  });

  it("renders empty state when no chapters are loaded", () => {
    const html = renderToStaticMarkup(<JourneyMap chapters={[]} isLoading={false} />);

    expect(html).toContain('data-testid="journey-empty"');
    expect(html).toContain("No journey chapters available yet");
  });

  it("renders loading indicator during live outline streaming", () => {
    const html = renderToStaticMarkup(<JourneyMap chapters={[]} isLoading={true} />);

    expect(html).toContain('data-testid="journey-loading-badge"');
    expect(html).toContain("Mapping concepts live");
  });
});
