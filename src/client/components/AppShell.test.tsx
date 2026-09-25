import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "./AppShell";

// Mock usePathname from next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/learn",
}));

describe("AppShell", () => {
  it("renders a skip to main content link targeting #main-content", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <div>Page Content</div>
      </AppShell>,
    );

    expect(html).toContain('href="#main-content"');
    expect(html).toContain("Skip to main content");
  });

  it("renders main landmark container with id=main-content", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <p>Main body</p>
      </AppShell>,
    );

    expect(html).toContain('<main id="main-content"');
    expect(html).toContain("<p>Main body</p>");
  });

  it("renders learner navigation links by default", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ role: "learner" }}>
        <div>Content</div>
      </AppShell>,
    );

    expect(html).toContain('href="/learn"');
    // /journey was never a route, so this link 404ed for every role.
    expect(html).not.toContain('href="/journey"');
    expect(html).toContain('href="/learn/progress"');
    expect(html).not.toContain('href="/admin"');
  });

  it("renders manager dashboard and reports links for manager role", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ role: "manager" }}>
        <div>Content</div>
      </AppShell>,
    );

    expect(html).toContain('href="/manage"');
    // The route is report, singular.
    expect(html).toContain('href="/manage/report"');
    expect(html).not.toContain('href="/manage/reports"');
  });

  it("renders admin config and audit links for admin role", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ role: "admin" }}>
        <div>Content</div>
      </AppShell>,
    );

    // /admin is a stub that redirects; the settings screen itself is /admin/config.
    expect(html).toContain('href="/admin/config"');
    expect(html).toContain('href="/admin/audit"');
  });

  it("renders accessibility toolbar with contrast, text scale and language buttons", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <div>Content</div>
      </AppShell>,
    );

    expect(html).toContain('aria-label="Accessibility options"');
    expect(html).toContain("EN");
    expect(html).toContain("اردو");
    expect(html).toContain("Roman");
  });

  // Three nav links pointed at routes that did not exist and every one of them 404ed in the
  // browser. The unit tests asserted the broken hrefs, so they passed the whole time.
  it("links only to routes that exist", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const appDir = path.resolve(process.cwd(), "src/app");

    const routeExists = (href: string): boolean => {
      // Route groups are (name) directories that do not appear in the URL, so try every one.
      const groups = fs
        .readdirSync(appDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("("))
        .map((d) => d.name);
      const rel = href.replace(/^\//, "");
      const candidates = ["", ...groups].map((g) => path.join(appDir, g, rel, "page.tsx"));
      return candidates.some((c) => fs.existsSync(c));
    };

    for (const role of ["learner", "manager", "ld_manager", "admin"]) {
      const html = renderToStaticMarkup(
        <AppShell user={{ role }}>
          <div>Content</div>
        </AppShell>,
      );
      const hrefs = [...html.matchAll(/href="(\/[^"#]*)"/g)]
        .map((m) => m[1]!)
        .filter((h) => !h.startsWith("/#"));
      for (const href of new Set(hrefs)) {
        expect(routeExists(href), `${role} nav links to ${href}, which has no page`).toBe(true);
      }
    }
  });
});
