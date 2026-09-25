export type AppLanguage = "en" | "ur" | "ur-Latn" | "mixed";

export interface StringDictionary {
  [key: string]: {
    en: string;
    ur: string;
    "ur-Latn": string;
  };
}

export const STRINGS: StringDictionary = {
  skipToContent: {
    en: "Skip to main content",
    ur: "مرکزی مواد پر جائیں",
    "ur-Latn": "Markazi mawad par jayen",
  },
  appName: {
    en: "Mashq",
    ur: "مشق",
    "ur-Latn": "Mashq",
  },
  tagline: {
    en: "Adaptive Learning Engine",
    ur: "ہم آہنگ تعلیمی نظام",
    "ur-Latn": "Ham-aahang taleemi nizam",
  },
  // Navigation
  navPractise: {
    en: "Practise",
    ur: "مشق کریں",
    "ur-Latn": "Mashq karein",
  },
  navJourney: {
    en: "Journey Map",
    ur: "سفر کا نقشہ",
    "ur-Latn": "Safar ka naqsha",
  },
  navDashboard: {
    en: "Dashboard",
    ur: "ڈیش بورڈ",
    "ur-Latn": "Dashboard",
  },
  navLibrary: {
    en: "Content library",
    ur: "مواد کی لائبریری",
    "ur-Latn": "Mawad ki library",
  },
  navReports: {
    en: "Reports",
    ur: "رپورٹس",
    "ur-Latn": "Reports",
  },
  navConfig: {
    en: "Configuration",
    ur: "ترتیبات",
    "ur-Latn": "Tarteebat",
  },
  navAudit: {
    en: "Audit Log",
    ur: "آڈٹ لاگ",
    "ur-Latn": "Audit log",
  },
  navSignOut: {
    en: "Sign out",
    ur: "سائن آؤٹ",
    "ur-Latn": "Sign out",
  },
  navSignIn: {
    en: "Sign in",
    ur: "سائن ان",
    "ur-Latn": "Sign in",
  },
  // Accessibility controls
  a11yControls: {
    en: "Accessibility options",
    ur: "رسائی کے اختیارات",
    "ur-Latn": "Rasai ke ikhtiyarat",
  },
  textSize: {
    en: "Text size",
    ur: "تحریر کا سائز",
    "ur-Latn": "Tehreer ka size",
  },
  highContrast: {
    en: "High contrast",
    ur: "زیادہ کنٹراسٹ",
    "ur-Latn": "Zyada contrast",
  },
  language: {
    en: "Language",
    ur: "زبان",
    "ur-Latn": "Zaban",
  },
  // Common interaction
  holdToTalk: {
    en: "Hold to talk",
    ur: "بولنے کے لیے دبا کر رکھیں",
    "ur-Latn": "Bolnay ke liye daba kar rakhein",
  },
  typeReply: {
    en: "Type a reply...",
    ur: "جواب تحریر کریں...",
    "ur-Latn": "Jawab tehreer karein...",
  },
  submit: {
    en: "Submit",
    ur: "جمع کرائیں",
    "ur-Latn": "Jama karayein",
  },
  inspector: {
    en: "Inspector",
    ur: "معائنہ کار",
    "ur-Latn": "Inspector",
  },
  navProgress: {
    en: "My progress",
    ur: "میری پیش رفت",
    "ur-Latn": "Meri pesh raft",
  },
  // Learner home
  learnTitle: {
    en: "Practise",
    ur: "مشق",
    "ur-Latn": "Mashq",
  },
  learnSubtitle: {
    en: "Turn your material into a guided practice session.",
    ur: "اپنے مواد کو رہنمائی والی مشق میں بدلیں۔",
    "ur-Latn": "Apne mawad ko rehnumai wali mashq mein badlein.",
  },
  engineInspector: {
    en: "Engine Inspector",
    ur: "انجن معائنہ کار",
    "ur-Latn": "Engine Inspector",
  },
  hideInspector: {
    en: "Hide Inspector",
    ur: "معائنہ کار چھپائیں",
    "ur-Latn": "Inspector chupayein",
  },
  journeyMap: {
    en: "Journey Map",
    ur: "سفر کا نقشہ",
    "ur-Latn": "Safar ka naqsha",
  },
  preparingSession: {
    en: "Preparing session environment...",
    ur: "سیشن تیار کیا جا رہا ہے...",
    "ur-Latn": "Session tayyar kiya ja raha hai...",
  },
  close: {
    en: "Close",
    ur: "بند کریں",
    "ur-Latn": "Band karein",
  },
  // Sign in
  signInTitle: {
    en: "Sign in to Mashq",
    ur: "مشق میں سائن ان کریں",
    "ur-Latn": "Mashq mein sign in karein",
  },
  email: {
    en: "Email",
    ur: "ای میل",
    "ur-Latn": "Email",
  },
  password: {
    en: "Password",
    ur: "پاس ورڈ",
    "ur-Latn": "Password",
  },
  signInSubtitle: {
    en: "Use the account you were given for this demo.",
    ur: "اس ڈیمو کے لیے دیا گیا اکاؤنٹ استعمال کریں۔",
    "ur-Latn": "Is demo ke liye diya gaya account istemal karein.",
  },
  signInTooMany: {
    en: "Too many sign-in attempts. Wait a minute and try again.",
    ur: "سائن ان کی بہت زیادہ کوششیں۔ ایک منٹ رک کر دوبارہ کوشش کریں۔",
    "ur-Latn": "Sign in ki bohat zyada koshishein. Aik minute ruk kar dobara koshish karein.",
  },
  signInWrong: {
    en: "That email and password did not match. Check both and try again.",
    ur: "یہ ای میل اور پاس ورڈ مطابقت نہیں رکھتے۔ دونوں دیکھ کر دوبارہ کوشش کریں۔",
    "ur-Latn": "Ye email aur password mutabiqat nahi rakhte. Dono dekh kar dobara koshish karein.",
  },
  // Progress
  progressTitle: {
    en: "My progress",
    ur: "میری پیش رفت",
    "ur-Latn": "Meri pesh raft",
  },
};

/**
 * Look up a localized UI string by key and language.
 * Falls back to English if the requested language or key is missing.
 */
export function t(key: string, lang: AppLanguage = "en"): string {
  const entry = STRINGS[key];
  if (!entry) return key;

  if (lang === "ur") return entry.ur;
  if (lang === "ur-Latn") return entry["ur-Latn"];
  // For 'mixed' or 'en', default to English
  return entry.en;
}
