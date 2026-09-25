import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickStart } from "./QuickStart";
import { CapabilitiesProvider } from "@/client/session/Capabilities";

/**
 * The upload controls used to render for everyone. A learner in an organization that has turned
 * content.learnerUploads off could drag a file in, wait for it to parse, and only then be told
 * no by the API. The route refusing is the security boundary and is unchanged; this is about
 * not offering a control that always fails.
 */
describe("QuickStart upload surface", () => {
  const render = (canUpload: boolean) =>
    renderToStaticMarkup(
      <CapabilitiesProvider value={{ role: "learner", canUpload }}>
        <QuickStart />
      </CapabilitiesProvider>,
    );

  it("offers upload, paste and URL when the person may add content", () => {
    const html = render(true);
    expect(html).toContain('data-testid="tab-file"');
    expect(html).toContain('data-testid="tab-paste"');
    expect(html).toContain('data-testid="tab-url"');
    expect(html).not.toContain('data-testid="uploads-disabled-note"');
  });

  it("offers none of them when the server would refuse, and says who to ask", () => {
    const html = render(false);
    expect(html).toContain('data-testid="uploads-disabled-note"');
    expect(html).toContain("L&amp;D team");
    // The panels go too: hiding only the tab strip leaves the active panel on screen.
    expect(html).not.toContain('data-testid="doc-title-input"');
    expect(html).not.toContain('data-testid="paste-textarea"');
  });

  it("defaults to hiding when there is no provider, rather than revealing", () => {
    const html = renderToStaticMarkup(<QuickStart />);
    expect(html).toContain('data-testid="uploads-disabled-note"');
  });
});
