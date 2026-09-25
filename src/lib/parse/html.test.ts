import { describe, it, expect } from "vitest";
import { parseHtml } from "./html";

const page = `<!doctype html><html><head><title>Account opening guide</title></head><body>
<nav><a href="/">Home</a><a href="/x">Other</a></nav>
<article>
<h1>Account opening guide</h1>
<p>Every new account starts with identity verification. The officer checks the CNIC and takes a photo.</p>
<h2>Step 1: Verify identity</h2>
<p>Ask the customer for an original CNIC. Compare the photo and the signature with the form.</p>
<ul><li>Original CNIC only</li><li>No photocopies</li></ul>
<h2>Step 2: Complete KYC</h2>
<p>Fill the know-your-customer form with source of income and expected turnover. Confirm the mobile number.</p>
<h2 id="faq">Questions</h2>
<p>If the CNIC has expired, the account cannot be opened until it is renewed. Direct the customer to NADRA.</p>
</article>
<footer>Copyright</footer></body></html>`;

describe("parseHtml", () => {
  it("extracts the article into heading sections with stable anchor refs", () => {
    const doc = parseHtml(page, "https://bank.example/guide");
    expect(doc.title).toBe("Account opening guide");
    expect(doc.sourceType).toBe("url");
    expect(doc.blocks.map((b) => b.heading)).toEqual([
      "Account opening guide",
      "Step 1: Verify identity",
      "Step 2: Complete KYC",
      "Questions",
    ]);
    expect(doc.blocks.map((b) => b.ref)).toEqual([
      "https://bank.example/guide#top",
      "https://bank.example/guide#step-1-verify-identity",
      "https://bank.example/guide#step-2-complete-kyc",
      "https://bank.example/guide#faq",
    ]);
    expect(doc.blocks[1]!.text).toContain("Original CNIC only");
    expect(doc.text).not.toContain("Copyright");
    expect(doc.blocks.every((b) => b.kind === "url")).toBe(true);
  });

  it("falls back to one block when there are no headings", () => {
    const doc = parseHtml(
      "<html><head><title>Plain</title></head><body><article><p>" +
        "A sentence about branch service. ".repeat(30) +
        "</p></article></body></html>",
      "https://x.test/p",
    );
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.ref).toBe("https://x.test/p#top");
  });

  it("throws a readable error when there is no article", () => {
    expect(() => parseHtml("<html><body></body></html>", "https://x.test/empty")).toThrow(
      /no readable article text/,
    );
  });
});
