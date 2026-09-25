import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickStart } from "./QuickStart";
import { CapabilitiesProvider } from "@/client/session/Capabilities";

// The intake surface is hidden from anyone the API would refuse, so these render as a person
// who may add content. QuickStart.capabilities.test.tsx covers the other direction.
const withUpload = (node: React.ReactElement) =>
  renderToStaticMarkup(
    <CapabilitiesProvider value={{ role: "ld_manager", canUpload: true }}>
      {node}
    </CapabilitiesProvider>,
  );

describe("QuickStart", () => {
  it("renders input tabs for paste, file and url", () => {
    const html = withUpload(<QuickStart />);

    expect(html).toContain('data-testid="tab-paste"');
    expect(html).toContain('data-testid="tab-file"');
    expect(html).toContain('data-testid="tab-url"');
  });

  it("renders persona and language selectors with options", () => {
    const html = withUpload(<QuickStart />);

    expect(html).toContain('data-testid="persona-select"');
    expect(html).toContain("Branch new joiner");
    expect(html).toContain("Senior manager");

    expect(html).toContain('data-testid="language-select"');
    expect(html).toContain("English");
    expect(html).toContain("Roman Urdu");
  });

  it("renders submit button to generate practice journey", () => {
    const html = withUpload(<QuickStart />);

    expect(html).toContain('data-testid="submit-button"');
    expect(html).toContain("Generate Practice Journey");
  });
});
