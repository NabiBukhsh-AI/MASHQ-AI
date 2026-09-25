import { describe, it, expect } from "vitest";
import { createRedactor, redact, totalRedactions } from "./redact";

// Luhn-valid test numbers (public test PANs) and a mod-97-valid PK IBAN.
const CARD16 = "4111 1111 1111 1111";
const CARD16_BAD = "4111 1111 1111 1112";
const CARD13 = "4222222222222";
const CARD19 = "6011 1111 1111 1111 110";
const IBAN = "PK36SCBL0000001123456702";
const IBAN_SPACED = "PK36 SCBL 0000 0011 2345 6702";
const IBAN_BAD = "PK36SCBL0000001123456703";

type Case = {
  name: string;
  input: string;
  expected: string;
  counts?: Partial<Record<string, number>>;
};

const cases: Case[] = [
  // CNIC
  {
    name: "dashed CNIC",
    input: "CNIC 42101-1234567-1 confirmed",
    expected: "CNIC [CNIC-1] confirmed",
  },
  { name: "bare 13-digit CNIC", input: "id 4210112345671 ok", expected: "id [CNIC-1] ok" },
  {
    name: "Urdu digits CNIC",
    input: "شناختی کارڈ ۴۲۱۰۱-۱۲۳۴۵۶۷-۱ درج کریں",
    expected: "شناختی کارڈ [CNIC-1] درج کریں",
  },
  { name: "Arabic-Indic bare CNIC", input: "٤٢١٠١١٢٣٤٥٦٧١", expected: "[CNIC-1]" },
  {
    name: "same CNIC twice, one number",
    input: "42101-1234567-1 and again 42101-1234567-1",
    expected: "[CNIC-1] and again [CNIC-1]",
  },
  {
    name: "two CNICs, two numbers",
    input: "42101-1234567-1, 35202-7654321-9",
    expected: "[CNIC-1], [CNIC-2]",
  },
  { name: "12 digits is not a CNIC", input: "ref 421011234567", expected: "ref 421011234567" },
  { name: "14 digits is not a CNIC", input: "ref 42101123456712", expected: "ref 42101123456712" },
  {
    name: "CNIC glued to letters still matches",
    input: "CNIC:42101-1234567-1.",
    expected: "CNIC:[CNIC-1].",
  },
  // Phone
  { name: "+92 mobile", input: "call +92 300 1234567 now", expected: "call [PHONE-1] now" },
  { name: "+92 compact", input: "+923001234567", expected: "[PHONE-1]" },
  { name: "0092 prefix", input: "0092-300-1234567", expected: "[PHONE-1]" },
  { name: "03xx local", input: "mobile 0300-1234567", expected: "mobile [PHONE-1]" },
  { name: "03xx compact", input: "03001234567", expected: "[PHONE-1]" },
  { name: "Urdu digit phone", input: "نمبر ۰۳۰۰۱۲۳۴۵۶۷ ہے", expected: "نمبر [PHONE-1] ہے" },
  {
    name: "same number in two formats maps to one placeholder",
    input: "0300-1234567 / 03001234567",
    expected: "[PHONE-1] / [PHONE-1]",
  },
  {
    name: "0092 number that happens to pass Luhn is still a phone",
    input: "0092 300 1234569",
    expected: "[PHONE-1]",
    counts: { phone: 1, card: 0 },
  },
  {
    name: "two adjacent mobiles are two phones, not one card",
    input: "0300 1234567 0300 1234568",
    expected: "[PHONE-1] [PHONE-2]",
    counts: { phone: 2, card: 0 },
  },
  {
    name: "country-code forms of one subscriber share a placeholder",
    input: "0300-1234567, +92 300 1234567, 0092 300 1234567",
    expected: "[PHONE-1], [PHONE-1], [PHONE-1]",
  },
  { name: "landline 021 is left alone", input: "021-34567890", expected: "021-34567890" },
  { name: "helpline 111 is left alone", input: "111 825 888", expected: "111 825 888" },
  {
    name: "phone inside longer digits is not matched",
    input: "1030012345678",
    expected: "[CNIC-1]",
  },
  // IBAN
  { name: "valid IBAN", input: `IBAN ${IBAN} pay`, expected: "IBAN [IBAN-1] pay" },
  { name: "spaced IBAN", input: `IBAN ${IBAN_SPACED} pay`, expected: "IBAN [IBAN-1] pay" },
  {
    name: "spaced and compact IBAN share a number",
    input: `${IBAN} ${IBAN_SPACED}`,
    expected: "[IBAN-1] [IBAN-1]",
  },
  { name: "invalid IBAN checksum left alone", input: IBAN_BAD, expected: IBAN_BAD },
  {
    name: "IBAN digits are not re-read as a card",
    input: IBAN,
    expected: "[IBAN-1]",
    counts: { card: 0 },
  },
  // Card
  { name: "16-digit card with spaces", input: `card ${CARD16}`, expected: "card [CARD-1]" },
  { name: "16-digit card with dashes", input: "4111-1111-1111-1111", expected: "[CARD-1]" },
  { name: "13-digit Luhn-valid card", input: CARD13, expected: "[CARD-1]" },
  { name: "19-digit card", input: CARD19, expected: "[CARD-1]" },
  { name: "invalid Luhn left alone", input: `card ${CARD16_BAD}`, expected: `card ${CARD16_BAD}` },
  {
    name: "card and CNIC in one line",
    input: `${CARD16} for 42101-1234567-1`,
    expected: "[CARD-1] for [CNIC-1]",
  },
  // Email
  {
    name: "plain email",
    input: "mail ali.khan@example.com today",
    expected: "mail [EMAIL-1] today",
  },
  {
    name: "email inside Urdu text",
    input: "ای میل ali@example.com پر بھیجیں",
    expected: "ای میل [EMAIL-1] پر بھیجیں",
  },
  { name: "email with plus and subdomain", input: "a+b@mail.example.co.uk", expected: "[EMAIL-1]" },
  {
    name: "email case-insensitive numbering",
    input: "Ali@X.com ali@x.com",
    expected: "[EMAIL-1] [EMAIL-1]",
  },
  { name: "two emails", input: "a@x.com b@y.org", expected: "[EMAIL-1] [EMAIL-2]" },
  {
    name: "at sign without domain is not an email",
    input: "reply @ noon",
    expected: "reply @ noon",
  },
  // No false positives
  { name: "amount 50,000", input: "Rs 50,000 limit", expected: "Rs 50,000 limit" },
  { name: "amount 1,250,000.50", input: "PKR 1,250,000.50", expected: "PKR 1,250,000.50" },
  { name: "date", input: "on 18/09/2026 at 09:30", expected: "on 18/09/2026 at 09:30" },
  { name: "ISO date and time", input: "2026-09-18T09:30:00", expected: "2026-09-18T09:30:00" },
  {
    name: "ticket and reference",
    input: "ticket 4521, ref AB-4521",
    expected: "ticket 4521, ref AB-4521",
  },
  { name: "year list", input: "2019 2020 2021 2022", expected: "2019 2020 2021 2022" },
  { name: "account number of 10 digits", input: "acct 0123456789", expected: "acct 0123456789" },
  { name: "empty string", input: "", expected: "" },
  // Mixed
  {
    name: "everything at once",
    input: `Mr Rasheed (42101-1234567-1, 0300-1234567, r@example.com) paid from ${IBAN_SPACED} by ${CARD16}.`,
    expected: "Mr Rasheed ([CNIC-1], [PHONE-1], [EMAIL-1]) paid from [IBAN-1] by [CARD-1].",
    counts: { cnic: 1, phone: 1, email: 1, iban: 1, card: 1 },
  },
];

describe("redact", () => {
  it.each(cases)("$name", ({ input, expected, counts }) => {
    const result = redact(input);
    expect(result.text).toBe(expected);
    if (counts)
      for (const [k, v] of Object.entries(counts))
        expect(result.counts[k as keyof typeof result.counts]).toBe(v);
  });

  it("has at least 40 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it("counts match placeholders", () => {
    const r = redact("42101-1234567-1 0300-1234567 a@b.co");
    expect(totalRedactions(r.counts)).toBe(3);
    expect(r.counts).toEqual({ cnic: 1, phone: 1, iban: 0, card: 0, email: 1 });
  });
});

describe("createRedactor", () => {
  it("keeps numbering consistent across calls and independent between redactors", () => {
    const r = createRedactor();
    expect(r.redact("first 42101-1234567-1").text).toBe("first [CNIC-1]");
    expect(r.redact("then 35202-7654321-9 and 42101-1234567-1").text).toBe(
      "then [CNIC-2] and [CNIC-1]",
    );
    expect(createRedactor().redact("35202-7654321-9").text).toBe("[CNIC-1]");
  });

  it("per-call counts count occurrences in that call only", () => {
    const r = createRedactor();
    r.redact("42101-1234567-1");
    expect(r.redact("42101-1234567-1 42101-1234567-1").counts.cnic).toBe(2);
  });
});

describe("redact: performance", () => {
  it("stays linear on long alphanumeric runs", () => {
    for (const run of ["a".repeat(200_000), "1".repeat(200_000), "a.".repeat(100_000)]) {
      const started = performance.now();
      redact(run);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });
});
