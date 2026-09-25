import { describe, it, expect } from "vitest";
import { detectLang } from "./lang";

// 30 labelled samples: 8 English, 8 Urdu script, 8 Roman Urdu, 6 mixed.
const samples: [string, "en" | "ur" | "ur-Latn" | "mixed"][] = [
  ["Please verify the customer's CNIC before opening the account.", "en"],
  ["The branch opens at nine and closes at five on weekdays.", "en"],
  ["Complete the KYC form and confirm the mobile number.", "en"],
  ["Escalate any suspicious transaction to the compliance officer.", "en"],
  ["A savings account requires a minimum balance of five thousand rupees.", "en"],
  ["Greet every customer, listen first, then offer a solution.", "en"],
  ["Refer to the IBAN on the printed statement for transfers.", "en"],
  ["Training completes when all three modules are passed.", "en"],
  ["السلام علیکم! آج ہم اکاؤنٹ کھولنے کے مراحل سیکھیں گے۔", "ur"],
  ["پہلے کسٹمر کا شناختی کارڈ چیک کریں۔", "ur"],
  ["آپ اس صورتحال میں کیا کریں گے؟", "ur"],
  ["یہ عمل تین مراحل پر مشتمل ہے: پہلا، دوسرا اور تیسرا۔", "ur"],
  ["جب کوئی بزرگ کسٹمر برانچ آئے تو پہلے انہیں بیٹھنے کی جگہ دیں۔", "ur"],
  ["براہ کرم فارم مکمل کریں اور دستخط کریں۔", "ur"],
  ["اکاؤنٹ کھولنے کے لیے اصل شناختی کارڈ ضروری ہے۔", "ur"],
  ["مسٹر رشید آج برانچ آئے ہیں۔", "ur"],
  ["Pehle customer ka CNIC check karein, phir KYC form mukammal karein.", "ur-Latn"],
  ["Bohat khoob! Aap ne bilkul sahi step choose kiya.", "ur-Latn"],
  ["Mujhe samajh nahi aaya, dobara bataiye.", "ur-Latn"],
  ["Agar CNIC expire ho gaya hai to account nahi khul sakta.", "ur-Latn"],
  ["Hum customer ko pehle bithate hain aur phir baat sunte hain.", "ur-Latn"],
  ["Ye form kaise bharna hai?", "ur-Latn"],
  ["Aap ka account teen din mein active ho jaye ga.", "ur-Latn"],
  ["Zara aahista bataiye, main note kar raha hoon.", "ur-Latn"],
  ["پہلے customer کا CNIC چیک کریں، پھر KYC فارم مکمل کریں۔", "mixed"],
  ["آپ کا ticket نمبر 4521 ہے، اور meeting ساڑھے تین بجے ہے۔", "mixed"],
  ["مسٹر رشید آج branch آئے ہیں اور account update کروانا چاہتے ہیں۔", "mixed"],
  ["Compliance officer کو فوراً inform کریں۔", "mixed"],
  ["IBAN اور account number دونوں statement پر موجود ہیں۔", "mixed"],
  ["Savings account کے لیے minimum balance پانچ ہزار روپے ہے۔", "mixed"],
];

describe("detectLang", () => {
  it.each(samples)("%s -> %s", (text, expected) => {
    expect(detectLang(text)).toBe(expected);
  });

  it("gets at least 29 of the 30 samples right", () => {
    const right = samples.filter(([t, l]) => detectLang(t) === l).length;
    expect(right).toBeGreaterThanOrEqual(29);
  });

  it("treats empty or numeric input as English", () => {
    expect(detectLang("")).toBe("en");
    expect(detectLang("4521 12:30")).toBe("en");
  });
});
