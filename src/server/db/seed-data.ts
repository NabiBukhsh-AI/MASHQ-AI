export const SEED_ORG = { name: "Demo Bank", slug: "demo-bank" } as const;

export const SEED_BADGES = [
  {
    code: "first_mission",
    name: "First mission",
    nameUr: "پہلا مشن",
    description: "Completed a first mission.",
    criteria: { missionsCompleted: 1 },
  },
  {
    code: "teach_back",
    name: "In your own words",
    nameUr: "اپنے الفاظ میں",
    description: "Explained a concept in your own words with a strong result.",
    criteria: { signal: "teach_back", minScore: 0.8 },
  },
  {
    code: "self_correct",
    name: "Second look",
    nameUr: "دوسری نظر",
    description: "Corrected a mistake without a hint.",
    criteria: { selfCorrected: 1 },
  },
  {
    code: "streak_3",
    name: "Three days running",
    nameUr: "تین دن مسلسل",
    description: "Practised on three days in a row.",
    criteria: { streakDays: 3 },
  },
] as const;
