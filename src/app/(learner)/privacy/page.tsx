"use client";

import React, { useCallback, useState } from "react";

/**
 * The privacy page, in English and Urdu.
 *
 * Written to be read by a branch employee, not a lawyer. The claim that matters most to a
 * learner using voice is that their audio is never stored by us, so it is stated first and in
 * both languages.
 */
const SECTIONS = [
  {
    en: {
      h: "Your voice is never stored",
      p: "When you speak, your audio goes from your browser straight to the speech provider and is never saved on our servers. We keep only the text of what was recognised, shortened and with personal numbers removed.",
    },
    ur: {
      h: "آپ کی آواز کبھی محفوظ نہیں کی جاتی",
      p: "جب آپ بولتے ہیں تو آپ کی آواز آپ کے براؤزر سے سیدھی تقریر فراہم کنندہ تک جاتی ہے اور ہمارے سرورز پر کبھی محفوظ نہیں ہوتی۔ ہم صرف پہچانے گئے الفاظ کا متن رکھتے ہیں، مختصر شکل میں اور ذاتی نمبر ہٹا کر۔",
    },
  },
  {
    en: {
      h: "What we keep, and for how long",
      p: "Your answers and replies are kept for 30 days. The signals we use to estimate what you have learned are kept for 180 days. Records of model usage, which contain no text, are kept for 90 days. Your estimated mastery is kept until you ask us to delete it.",
    },
    ur: {
      h: "ہم کیا رکھتے ہیں اور کتنی دیر",
      p: "آپ کے جوابات اور گفتگو تیس دن رکھے جاتے ہیں۔ آپ کی سیکھنے کی پیش رفت کے اشارے ایک سو اسی دن رکھے جاتے ہیں۔ ماڈل کے استعمال کا ریکارڈ، جس میں کوئی متن نہیں ہوتا، نوے دن رکھا جاتا ہے۔ آپ کی تخمینی مہارت اس وقت تک رہتی ہے جب تک آپ حذف کرنے کو نہ کہیں۔",
    },
  },
  {
    en: {
      h: "Personal numbers are removed before anything is sent",
      p: "Before your words reach any model or speech provider, we remove things like CNIC numbers, phone numbers, card numbers, account numbers and email addresses.",
    },
    ur: {
      h: "بھیجنے سے پہلے ذاتی نمبر ہٹا دیے جاتے ہیں",
      p: "آپ کے الفاظ کسی ماڈل یا تقریر فراہم کنندہ تک پہنچنے سے پہلے، ہم شناختی کارڈ نمبر، فون نمبر، کارڈ نمبر، اکاؤنٹ نمبر اور ای میل پتے ہٹا دیتے ہیں۔",
    },
  },
  {
    en: {
      h: "Who can see your work",
      p: "Your manager sees progress by pseudonym, not by name, unless your organization turns that off. Nobody outside your organization can see any of it.",
    },
    ur: {
      h: "آپ کا کام کون دیکھ سکتا ہے",
      p: "آپ کے منتظم کو پیش رفت فرضی نام سے نظر آتی ہے، اصل نام سے نہیں، جب تک آپ کا ادارہ اسے تبدیل نہ کرے۔ آپ کے ادارے سے باہر کوئی بھی یہ نہیں دیکھ سکتا۔",
    },
  },
];

export default function PrivacyPage(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const download = useCallback(() => {
    window.location.href = "/api/me/data";
  }, []);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/me/data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE MY DATA" }),
      });
      if (!res.ok) throw new Error("The deletion did not complete. Try again.");
      const body = (await res.json()) as { deleted: Record<string, number> };
      setMessage(
        `Deleted. ${body.deleted.sessions} sessions and everything linked to them have been removed.`,
      );
      setConfirming(false);
      setTyped("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The deletion did not complete. Try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8" data-testid="privacy-page">
      <h1 className="text-ink text-xl font-bold tracking-tight">Your data</h1>

      {SECTIONS.map((s) => (
        <section key={s.en.h} className="mt-6">
          <h2 className="text-ink text-sm font-semibold">{s.en.h}</h2>
          <p className="text-ink/80 mt-1 text-sm">{s.en.p}</p>
          <h3
            lang="ur"
            dir="rtl"
            className="text-ink mt-3 text-sm font-semibold"
            style={{ lineHeight: 2.1 }}
          >
            {s.ur.h}
          </h3>
          <p lang="ur" dir="rtl" className="text-ink/80 mt-1 text-sm" style={{ lineHeight: 2.1 }}>
            {s.ur.p}
          </p>
        </section>
      ))}

      <section aria-label="Your choices" className="border-mist mt-10 rounded-lg border p-4">
        <h2 className="text-ink text-sm font-semibold">Your choices</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={download}
            data-testid="export-my-data"
            className="border-mist text-ink rounded-lg border px-4 py-2 text-xs font-semibold"
          >
            Download my data
          </button>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              data-testid="delete-my-data"
              className="border-kattha/40 text-kattha rounded-lg border px-4 py-2 text-xs font-semibold"
            >
              Delete my data
            </button>
          ) : (
            <div className="flex w-full flex-col gap-2">
              <label htmlFor="delete-confirm" className="text-ink text-xs">
                This cannot be undone. Type DELETE MY DATA to confirm.
              </label>
              <input
                id="delete-confirm"
                data-testid="delete-confirm-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="border-mist rounded-lg border px-2 py-1 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || typed !== "DELETE MY DATA"}
                  onClick={() => void remove()}
                  data-testid="delete-confirm-btn"
                  className="bg-kattha rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Deleting..." : "Delete everything"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setTyped("");
                  }}
                  className="border-mist text-ink rounded-lg border px-4 py-2 text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {message && (
          <p role="status" data-testid="privacy-message" className="text-ink mt-3 text-xs">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-kattha mt-3 text-xs">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
