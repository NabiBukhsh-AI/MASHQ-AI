import { z } from "zod";

// Two flavours of each model-facing schema: the
// "loose" one goes to the provider as the output format (providers reject
// regexes, exact lengths and some min/max in constrained decoding), and the
// strict one validates what came back. Code fills gaps or asks for a repair.

export const Mechanic = z.enum([
  "scenario",
  "roleplay",
  "puzzle",
  "decision",
  "teach_back",
  "final_challenge",
]);

export const L10n = z.object({ en: z.string(), ur: z.string(), urLatn: z.string() });
export type L10n = z.infer<typeof L10n>;

// Outline (A2)
const OutlineConcept = z.object({
  key: z.string(),
  name: z.string(),
  nameUr: z.string(),
  summary: z.string(),
  difficulty: z.number(),
  importance: z.number(),
  prerequisites: z.array(z.string()),
  chunkIds: z.array(z.string()),
});
const OutlineMission = z.object({
  key: z.string(),
  title: z.string(),
  objective: z.string(),
  conceptKeys: z.array(z.string()),
  mechanic: Mechanic,
  alternates: z.array(z.string()),
});
const OutlineChapter = z.object({
  key: z.string(),
  title: z.string(),
  arcBeat: z.string(),
  missions: z.array(OutlineMission),
});
const OutlineCharacter = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  mood: z.string(),
  voiceProfile: z.enum(["guide", "customer_elder", "customer_young", "new_joiner"]),
});
export const ConceptOutlineLoose = z.object({
  title: z.string(),
  summary: z.string(),
  concepts: z.array(OutlineConcept),
  chapters: z.array(OutlineChapter),
  story: z.object({
    setting: z.string(),
    premise: z.string(),
    characters: z.array(OutlineCharacter),
  }),
  warnings: z.array(z.string()),
});
export const ConceptOutline = ConceptOutlineLoose.extend({
  concepts: z
    .array(
      OutlineConcept.extend({
        key: z.string().regex(/^c_[a-z0-9_]{2,40}$/),
        difficulty: z.number().int().min(1).max(5),
        importance: z.number().int().min(1).max(5),
        chunkIds: z.array(z.string()).min(1),
      }),
    )
    .min(3)
    .max(30),
  chapters: z
    .array(
      OutlineChapter.extend({
        missions: z
          .array(
            OutlineMission.extend({
              conceptKeys: z.array(z.string()).min(1),
              alternates: z.array(z.string()).max(2),
            }),
          )
          .min(1)
          .max(4),
      }),
    )
    .min(1)
    .max(8),
  story: z.object({
    setting: z.string(),
    premise: z.string(),
    characters: z.array(OutlineCharacter).min(2).max(4),
  }),
});
export type ConceptOutline = z.infer<typeof ConceptOutline>;

// Facts (A4) and grounding (A6)
export const FactAnchor = z.object({ chunkId: z.string(), quote: z.string() });
export const FactLoose = z.object({
  id: z.string(),
  conceptKey: z.string(),
  statement: z.string(),
  anchors: z.array(FactAnchor),
});
export const Fact = FactLoose.extend({
  statement: z.string().max(300),
  anchors: z.array(FactAnchor.extend({ quote: z.string().min(10).max(300) })).min(1),
});
export type Fact = z.infer<typeof Fact>;

const MisconceptionLoose = z.object({
  id: z.string(),
  conceptKey: z.string(),
  belief: z.string(),
  correction: z.string(),
  factIds: z.array(z.string()),
});
export const FactsResultLoose = z.object({
  facts: z.array(FactLoose),
  misconceptions: z.array(MisconceptionLoose),
  applications: z.array(z.object({ conceptKey: z.string(), text: z.string() })),
  unsupported: z.array(z.string()),
});
export const FactsResult = FactsResultLoose.extend({
  facts: z.array(Fact),
  misconceptions: z.array(MisconceptionLoose.extend({ factIds: z.array(z.string()).min(1) })),
});
export type FactsResult = z.infer<typeof FactsResult>;

export const GroundingResult = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["supported", "partial", "unsupported"]),
      note: z.string().nullable(),
      corrected: z.string().nullable(),
    }),
  ),
});
export type GroundingResult = z.infer<typeof GroundingResult>;

// Glossary (A5)
export const GlossaryResult = z.object({
  terms: z.array(
    z.object({
      en: z.string(),
      ur: z.string(),
      roman: z.string(),
      definition: z.string(),
      speechHint: z.string(),
      chunkIds: z.array(z.string()),
    }),
  ),
});
export type GlossaryResult = z.infer<typeof GlossaryResult>;

// Mission pack (A3)
const Option = z.object({
  id: z.string(),
  label: L10n,
  correct: z.boolean(),
  consequence: z.string(),
  factIds: z.array(z.string()),
  misconceptionId: z.string().nullable(),
});
const KeyPoint = z.object({ text: z.string(), factIds: z.array(z.string()) });
export const QuestionLoose = z.object({
  id: z.string(),
  conceptKey: z.string(),
  kind: z.enum([
    "choice",
    "sequence",
    "match",
    "spot_error",
    "free_text",
    "explanation",
    "teach_back",
    "roleplay_turn",
  ]),
  prompt: z.string(),
  variants: z.object({ foundation: z.string(), standard: z.string(), advanced: z.string() }),
  options: z.array(Option).nullable(),
  sequence: z
    .object({
      steps: z.array(z.object({ id: z.string(), label: L10n })),
      correctOrder: z.array(z.string()),
    })
    .nullable(),
  pairs: z.array(z.object({ left: L10n, right: L10n })).nullable(),
  passage: z
    .object({
      sentences: z.array(z.object({ id: z.string(), text: L10n })),
      errorSentenceId: z.string(),
      misconceptionId: z.string(),
    })
    .nullable(),
  answerKey: z.object({ keyPoints: z.array(KeyPoint), rubric: z.array(z.string()) }).nullable(),
  hints: z.array(z.string()),
  workedExample: z.string(),
  factIds: z.array(z.string()),
});
export const Question = QuestionLoose.extend({
  prompt: z.string().max(400),
  options: z
    .array(Option.extend({ consequence: z.string().max(400) }))
    .min(2)
    .max(4)
    .nullable(),
  sequence: z
    .object({
      steps: z
        .array(z.object({ id: z.string(), label: L10n }))
        .min(4)
        .max(7),
      correctOrder: z.array(z.string()).min(4).max(7),
    })
    .nullable(),
  pairs: z
    .array(z.object({ left: L10n, right: L10n }))
    .min(4)
    .max(6)
    .nullable(),
  answerKey: z
    .object({
      keyPoints: z.array(KeyPoint.extend({ factIds: z.array(z.string()).min(1) })).min(1),
      rubric: z.array(z.string()),
    })
    .nullable(),
  hints: z.array(z.string()).length(3),
  workedExample: z.string().max(700),
  factIds: z.array(z.string()).min(1),
});
export type Question = z.infer<typeof Question>;

const Beat = z.object({
  id: z.string(),
  kind: z.enum(["intro", "scenario", "question", "consequence", "roleplay", "teach_back", "wrap"]),
  speaker: z.string(),
  text: z.string(),
  questionId: z.string().nullable(),
  next: z.object({
    correct: z.string().nullable(),
    partial: z.string().nullable(),
    incorrect: z.string().nullable(),
  }),
});
const Roleplay = z.object({
  customerId: z.string(),
  goal: z.string(),
  mood: z.string(),
  openers: z.array(z.string()),
  behaviors: z.array(z.object({ id: z.string(), text: z.string(), factIds: z.array(z.string()) })),
});
const TeachBack = z.object({ ask: z.string(), keyPoints: z.array(KeyPoint), followUp: z.string() });
const Callback = z.object({
  id: z.string(),
  conceptKey: z.string(),
  prompt: z.string(),
  keyPoints: z.array(z.string()),
});

export const MissionPackLoose = z.object({
  missionKey: z.string(),
  title: L10n,
  objective: z.string(),
  mechanic: z.string(),
  alternates: z.array(z.string()),
  beats: z.array(Beat),
  questions: z.array(QuestionLoose),
  roleplay: Roleplay.nullable(),
  teachBack: TeachBack.nullable(),
  callbacks: z.array(Callback),
  glossaryHints: z.array(z.object({ term: z.string(), speechUr: z.string() })),
});
export const MissionPack = MissionPackLoose.extend({
  alternates: z.array(z.string()).max(2),
  beats: z
    .array(Beat.extend({ text: z.string().max(600) }))
    .min(3)
    .max(8),
  questions: z.array(Question).min(2).max(8),
  roleplay: Roleplay.extend({
    openers: z.array(z.string()).length(3),
    behaviors: z
      .array(z.object({ id: z.string(), text: z.string(), factIds: z.array(z.string()).min(1) }))
      .min(3)
      .max(5),
  }).nullable(),
  teachBack: TeachBack.extend({
    keyPoints: z.array(KeyPoint.extend({ factIds: z.array(z.string()).min(1) })).min(2),
  }).nullable(),
  callbacks: z.array(Callback).length(2),
});
export type MissionPack = z.infer<typeof MissionPack>;

export const MissionWithFactsLoose = z.object({
  newFacts: z.array(FactLoose),
  pack: MissionPackLoose,
});
export const MissionWithFacts = z.object({ newFacts: z.array(Fact), pack: MissionPack });
export type MissionWithFacts = z.infer<typeof MissionWithFacts>;
