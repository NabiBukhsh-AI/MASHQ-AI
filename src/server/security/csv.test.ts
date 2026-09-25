import { describe, it, expect } from "vitest";
import { escapeCell, isFormula, toCsv, csvFilename } from "./csv";

describe("formula injection", () => {
  // A cell starting with any of these executes when the file opens in Excel or Sheets.
  const attacks = [
    "=1+1",
    "+1+1",
    "-1+1",
    "@SUM(A1)",
    '=HYPERLINK("http://evil.test","click")',
    "=cmd|'/c calc'!A1",
    "\t=1+1",
    "\r=1+1",
  ];

  for (const attack of attacks) {
    it(`neutralises ${JSON.stringify(attack)}`, () => {
      expect(isFormula(attack)).toBe(true);
      const cell = escapeCell(attack);
      // The value survives for a reader, but a spreadsheet reads it as text.
      expect(cell.startsWith("\"'") || cell.startsWith("'")).toBe(true);
    });
  }

  it("leaves ordinary text alone", () => {
    expect(escapeCell("Greeting within thirty seconds")).toBe("Greeting within thirty seconds");
    expect(isFormula("Greeting")).toBe(false);
  });

  it("does not treat a negative number in a numeric field as safe", () => {
    // -0.31 starts with a dash, so it is escaped rather than executed. A reader still sees it.
    const cell = escapeCell(-0.31);
    expect(cell).toContain("-0.31");
    expect(isFormula("-0.31")).toBe(true);
  });
});

describe("csv structure", () => {
  it("quotes and doubles embedded quotes", () => {
    expect(escapeCell('He said "hello"')).toBe('"He said ""hello"""');
  });

  it("quotes a value containing a comma or a newline, so the row cannot break", () => {
    expect(escapeCell("Branch Operations, Karachi")).toBe('"Branch Operations, Karachi"');
    expect(escapeCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("strips NUL bytes rather than writing them into the file", () => {
    expect(escapeCell("before\u0000after")).toBe("beforeafter");
  });

  it("writes empty for null and undefined instead of the words", () => {
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
  });

  it("writes a header row and one line per row, CRLF terminated", () => {
    const csv = toCsv(
      [
        { key: "a", header: "Topic" },
        { key: "b", header: "Score" },
      ],
      [
        { a: "Greeting", b: 0.72 },
        { a: "Listening", b: 0.31 },
      ],
    );
    expect(csv).toBe("Topic,Score\r\nGreeting,0.72\r\nListening,0.31\r\n");
  });

  it("escapes a header too, since column labels can come from content", () => {
    const csv = toCsv([{ key: "a", header: "=EVIL()" }], []);
    expect(csv.startsWith('"\'=EVIL()"')).toBe(true);
  });

  it("writes a header even when there are no rows", () => {
    expect(toCsv([{ key: "a", header: "Topic" }], [])).toBe("Topic\r\n");
  });

  it("serialises a date as ISO rather than a locale string", () => {
    expect(escapeCell(new Date("2026-09-20T10:00:00Z"))).toBe("2026-09-20T10:00:00.000Z");
  });
});

describe("filenames", () => {
  it("strips anything that could escape the download folder", () => {
    expect(csvFilename("../../etc/passwd")).not.toContain("/");
    expect(csvFilename('a"b')).not.toContain('"');
  });

  it("names the widget and the date", () => {
    expect(csvFilename("masteryMatrix", new Date("2026-09-20T00:00:00Z"))).toBe(
      "mashq-masteryMatrix-2026-09-20.csv",
    );
  });
});
