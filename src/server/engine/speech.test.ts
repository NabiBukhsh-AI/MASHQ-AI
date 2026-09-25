import { describe, it, expect } from "vitest";
import {
  normalizeDashes,
  toSpeech,
  stripMarkdown,
  urduNumberToWords,
  englishNumberToWords,
} from "./speech";
import fixtureSentences from "../../../eval/fixtures/speech/tts-sentences.json";

describe("Speech channel modes", () => {
  describe("stripMarkdown", () => {
    it("strips bold, italics, links, and code blocks cleanly", () => {
      const input =
        "**ضروری نوٹ:** برائے مہربانی [یہ فارم](https://example.com) ڈاؤنلوڈ کریں اور `CNIC` درج کریں۔";
      const stripped = stripMarkdown(input);
      expect(stripped).not.toContain("**");
      expect(stripped).not.toContain("https://");
      expect(stripped).not.toContain("[");
      expect(stripped).not.toContain("]");
      expect(stripped).not.toContain("`");
      expect(stripped).toBe("ضروری نوٹ: برائے مہربانی یہ فارم ڈاؤنلوڈ کریں اور CNIC درج کریں۔");
    });

    it("strips headers, blockquotes, and lists", () => {
      const input = [
        "# پہلا مرحلہ",
        "> یہ احتیاط ضروری ہے:",
        "- اصل شناختی کارڈ طلب کریں",
        "- دستخط کی تصدیق کریں",
      ].join("\n");

      const stripped = stripMarkdown(input);
      expect(stripped).not.toContain("#");
      expect(stripped).not.toContain(">");
      expect(stripped).not.toContain("-");
      expect(stripped).toContain("پہلا مرحلہ");
      expect(stripped).toContain("یہ احتیاط ضروری ہے:");
      expect(stripped).toContain("اصل شناختی کارڈ طلب کریں");
    });
  });

  describe("urduNumberToWords and englishNumberToWords", () => {
    it("converts Urdu numbers correctly across units, tens, hundreds, and thousands", () => {
      expect(urduNumberToWords(0)).toBe("صفر");
      expect(urduNumberToWords(5)).toBe("پانچ");
      expect(urduNumberToWords(21)).toBe("اکیس");
      expect(urduNumberToWords(100)).toBe("ایک سو");
      expect(urduNumberToWords(500)).toBe("پانچ سو");
      expect(urduNumberToWords(1000)).toBe("ایک ہزار");
      expect(urduNumberToWords(4521)).toBe("چار ہزار پانچ سو اکیس");
      expect(urduNumberToWords(100000)).toBe("ایک لاکھ");
    });

    it("converts English numbers correctly", () => {
      expect(englishNumberToWords(0)).toBe("zero");
      expect(englishNumberToWords(15)).toBe("fifteen");
      expect(englishNumberToWords(42)).toBe("forty-two");
      expect(englishNumberToWords(500)).toBe("five hundred");
      expect(englishNumberToWords(4521)).toBe("four thousand five hundred twenty-one");
    });
  });

  describe("toSpeech channel modes", () => {
    it("mirror mode keeps the display wording but strips markdown", () => {
      const sentence = "**Customer** کا شناختی کارڈ چیک کریں۔";
      const result = toSpeech(sentence, { lang: "ur", mode: "mirror" });
      expect(result).toBe("Customer کا شناختی کارڈ چیک کریں۔");
    });

    it("llm mode extracts @@s speech line when present", () => {
      const input =
        "@@d Pehle customer ka CNIC check karein.\n@@s پہلے کسٹمر کا شناختی کارڈ چیک کریں۔";
      const result = toSpeech(input, { lang: "ur-Latn", mode: "llm" });
      expect(result).toBe("پہلے کسٹمر کا شناختی کارڈ چیک کریں۔");
    });

    it("llm mode falls back to normalize when @@s line is absent", () => {
      const input = "Pehle customer ka CNIC check karein.";
      const result = toSpeech(input, { lang: "ur-Latn", mode: "llm" });
      expect(result).toBe("Pehle customer ka CNIC check karein.");
    });

    it("normalize mode strips markdown so markdown never reaches TTS", () => {
      const input =
        "### مرحلہ 1:\n**کسٹمر** کو خوش آمدید کہیں اور [رہنما](https://example.com) دیکھیں۔";
      const result = toSpeech(input, { lang: "ur", mode: "normalize" });
      expect(result).not.toContain("#");
      expect(result).not.toContain("**");
      expect(result).not.toContain("[");
      expect(result).not.toContain("https://");
      expect(result).toBe("مرحلہ ایک: کسٹمر کو خوش آمدید کہیں اور رہنما دیکھیں۔");
    });

    it("normalize mode applies glossary speech hints with highest priority", () => {
      const sentence = "پہلے customer کا KYC اور branch ریکارڈ چیک کریں۔";
      const result = toSpeech(sentence, {
        lang: "ur",
        mode: "normalize",
        glossary: [
          { term: "KYC", speechUr: "نو یور کسٹمر" },
          { term: "branch", speechUr: "شاخ" },
        ],
      });

      expect(result).toContain("نو یور کسٹمر");
      expect(result).toContain("شاخ");
      expect(result).not.toContain("کے وائی سی");
      expect(result).not.toContain("برانچ");
    });

    it("normalize mode expands percentage and currency symbols based on language", () => {
      const urduInput = "منافع کی شرح 15% ہے اور فیس Rs. 500 ہوگی۔";
      const urduResult = toSpeech(urduInput, {
        lang: "ur",
        mode: "normalize",
      });
      expect(urduResult).toContain("پندرہ فیصد");
      expect(urduResult).toContain("پانچ سو روپے");

      const enInput = "Interest is 15% and deposit is Rs. 500.";
      const enResult = toSpeech(enInput, { lang: "en", mode: "normalize" });
      expect(enResult).toContain("fifteen percent");
      expect(enResult).toContain("five hundred rupees");

      const romanUrduInput = "Munafa 15% hai aur fees PKR 500 hogi.";
      const romanUrduResult = toSpeech(romanUrduInput, {
        lang: "ur-Latn",
        mode: "normalize",
      });
      expect(romanUrduResult).toContain("feesad");
      expect(romanUrduResult).toContain("rupay");
    });

    it("normalize mode transliterates common banking terms and acronyms into Urdu script", () => {
      const input =
        "پہلے customer کا CNIC اور account چیک کریں، پھر biometric verification مکمل کریں۔";
      const result = toSpeech(input, {
        lang: "ur",
        mode: "normalize",
        mixedStrategy: "transliterate",
      });

      expect(result).toContain("کسٹمر");
      expect(result).toContain("سی این آئی سی");
      expect(result).toContain("اکاؤنٹ");
      expect(result).toContain("بائیومیٹرک");
      expect(result).toContain("ویریفکیشن");
      expect(result).not.toContain("customer");
      expect(result).not.toContain("CNIC");
      expect(result).not.toContain("account");
    });

    it("supports native and split mixedStrategies", () => {
      const input = "پہلے customer کا CNIC چیک کریں۔";

      const nativeResult = toSpeech(input, {
        lang: "ur",
        mode: "normalize",
        mixedStrategy: "native",
      });
      expect(nativeResult).toContain("customer");
      expect(nativeResult).toContain("CNIC");

      const splitResult = toSpeech(input, {
        lang: "ur",
        mode: "normalize",
        mixedStrategy: "split",
      });
      expect(splitResult).toContain(",");
    });
  });

  describe("Spike 1 fixture sentences", () => {
    it("processes all 12 spike sentences to high-quality spoken forms", () => {
      // s01 ur: السلام علیکم! آج ہم اکاؤنٹ کھولنے کے مراحل سیکھیں گے۔
      const s01 = fixtureSentences.find((s) => s.id === "s01")!;
      const r01 = toSpeech(s01.text, { lang: "ur", mode: "normalize" });
      expect(r01).toBe("السلام علیکم! آج ہم اکاؤنٹ کھولنے کے مراحل سیکھیں گے۔");

      // s02 mixed: پہلے customer کا CNIC چیک کریں، پھر KYC فارم مکمل کریں۔
      const s02 = fixtureSentences.find((s) => s.id === "s02")!;
      const r02 = toSpeech(s02.text, {
        lang: "mixed",
        mode: "normalize",
        mixedStrategy: "transliterate",
      });
      expect(r02).toContain("کسٹمر");
      expect(r02).toContain("سی این آئی سی");
      expect(r02).toContain("کے وائی سی");
      expect(r02).toContain("فارم");

      // s03 mixed with numbers: آپ کا ticket نمبر 4521 ہے، اور meeting ساڑھے تین بجے ہے۔
      const s03 = fixtureSentences.find((s) => s.id === "s03")!;
      const r03 = toSpeech(s03.text, {
        lang: "mixed",
        mode: "normalize",
        mixedStrategy: "transliterate",
      });
      expect(r03).toContain("ٹکٹ");
      expect(r03).toContain("میٹنگ");
      expect(r03).toContain("چار ہزار پانچ سو اکیس");

      // s04 ur-Latn: Pehle customer ka CNIC check karein, phir KYC form mukammal karein.
      const s04 = fixtureSentences.find((s) => s.id === "s04")!;
      const r04 = toSpeech(s04.text, {
        lang: "ur-Latn",
        mode: "normalize",
      });
      expect(r04).toBe("Pehle customer ka CNIC check karein, phir KYC form mukammal karein.");

      // s05 en: Let's practise the account update steps together.
      const s05 = fixtureSentences.find((s) => s.id === "s05")!;
      const r05 = toSpeech(s05.text, { lang: "en", mode: "normalize" });
      expect(r05).toBe("Let's practise the account update steps together.");

      // s06 en alphanumerics: Your reference is AB-4521, and the IBAN starts with PK.
      const s06 = fixtureSentences.find((s) => s.id === "s06")!;
      const r06 = toSpeech(s06.text, { lang: "en", mode: "normalize" });
      expect(r06).toContain("four thousand five hundred twenty-one");

      // s07 ur transliterated terms: پہلے کسٹمر کا سی این آئی سی چیک کریں۔
      const s07 = fixtureSentences.find((s) => s.id === "s07")!;
      const r07 = toSpeech(s07.text, { lang: "ur", mode: "normalize" });
      expect(r07).toBe("پہلے کسٹمر کا سی این آئی سی چیک کریں۔");

      // s08 ur question: آپ اس صورتحال میں کیا کریں گے؟
      const s08 = fixtureSentences.find((s) => s.id === "s08")!;
      const r08 = toSpeech(s08.text, { lang: "ur", mode: "normalize" });
      expect(r08).toBe("آپ اس صورتحال میں کیا کریں گے؟");

      // s10 ur long: جب کوئی بزرگ کسٹمر پریشانی میں برانچ آئے تو پہلے انہیں بیٹھنے کی جگہ دیں، تسلی سے بات سنیں، اور پھر قدم بہ قدم ان کا مسئلہ حل کریں۔
      const s10 = fixtureSentences.find((s) => s.id === "s10")!;
      const r10 = toSpeech(s10.text, { lang: "ur", mode: "normalize" });
      expect(r10).toContain("جب کوئی بزرگ کسٹمر پریشانی میں برانچ آئے");

      // s11 name with branch: مسٹر رشید آج branch آئے ہیں۔
      const s11 = fixtureSentences.find((s) => s.id === "s11")!;
      const r11 = toSpeech(s11.text, {
        lang: "ur",
        mode: "normalize",
        mixedStrategy: "transliterate",
      });
      expect(r11).toBe("مسٹر رشید آج برانچ آئے ہیں۔");

      // s12 ur list: یہ عمل تین مراحل پر مشتمل ہے: پہلا، دوسرا اور تیسرا۔
      const s12 = fixtureSentences.find((s) => s.id === "s12")!;
      const r12 = toSpeech(s12.text, { lang: "ur", mode: "normalize" });
      expect(r12).toBe("یہ عمل تین مراحل پر مشتمل ہے: پہلا، دوسرا اور تیسرا۔");
    });
  });

  describe("normalizeDashes", () => {
    it("replaces an em dash with a comma", () => {
      expect(normalizeDashes("That is right\u2014now try the next step.")).toBe(
        "That is right, now try the next step.",
      );
    });

    it("handles a spaced dash without doubling punctuation", () => {
      expect(normalizeDashes("Greet her \u2014 then listen.")).toBe("Greet her, then listen.");
      expect(normalizeDashes("one\u2013two")).toBe("one, two");
    });

    it("leaves a hyphen and ordinary text alone", () => {
      expect(normalizeDashes("A well-known KYC step.")).toBe("A well-known KYC step.");
    });
  });

  describe("glossary speech hints by language", () => {
    const glossary = [{ term: "CNIC", speechHint: "سی این آئی سی" }];

    it("uses the Urdu hint for an Urdu voice", () => {
      const out = toSpeech("Ask for the CNIC.", { lang: "ur", mode: "normalize", glossary });
      expect(out).toContain("سی این");
    });

    it("leaves an English session in English", () => {
      // The hints are written as "how an Urdu voice should say this", so applying them to an
      // English session puts Urdu script into English speech.
      const out = toSpeech("Ask for the CNIC.", { lang: "en", mode: "normalize", glossary });
      expect(out).toContain("CNIC");
      expect(out).not.toMatch(/[؀-ۿ]/);
    });
  });
});
