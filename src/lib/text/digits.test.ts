import { describe, it, expect } from "vitest";
import { normalizeDigits } from "./digits";

describe("normalizeDigits", () => {
  it("maps Arabic-Indic and Extended Arabic-Indic digits to ASCII, same length", () => {
    const input = "CNIC ۴۲۱۰۱-۱۲۳۴۵۶۷-۱ اور ٠٣٠٠١٢٣٤٥٦٧";
    const out = normalizeDigits(input);
    expect(out).toBe("CNIC 42101-1234567-1 اور 03001234567");
    expect(out.length).toBe(input.length);
  });
  it("leaves other text untouched", () => {
    expect(normalizeDigits("Rs 50,000 at 3:30pm")).toBe("Rs 50,000 at 3:30pm");
  });
});
