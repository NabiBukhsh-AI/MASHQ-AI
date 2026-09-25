import type { ConfigPatch } from "./schema";

// Session-scope patches, audited as preset_apply. Each preset
// must validate when merged over the defaults (checked in tests and on write).
export interface Preset {
  label: string;
  labelUr: string;
  patch: ConfigPatch;
}

export const PRESETS: Record<string, Preset> = {
  branch_new_joiner: {
    label: "Branch new joiner",
    labelUr: "برانچ کا نیا ساتھی",
    patch: {
      learner: { defaultPersonaId: "branch_new_joiner" },
      hints: { autoOfferAfterIncorrect: 1 },
      mechanics: { weights: { scenario: 1, roleplay: 0.95 } },
    },
  },
  senior_manager: {
    label: "Senior manager",
    labelUr: "سینئر منیجر",
    patch: {
      learner: { defaultPersonaId: "senior_manager" },
      language: { register: "formal" },
      mechanics: { weights: { decision: 1, teach_back: 0.95 } },
    },
  },
  urdu_first: {
    label: "Urdu-first",
    labelUr: "اردو پہلے",
    patch: { language: { default: "ur" }, voice: { output: { enabled: true } } },
  },
  roman_urdu: {
    label: "Roman Urdu",
    labelUr: "رومن اردو",
    patch: { language: { default: "ur-Latn" } },
  },
  audio_off: {
    label: "Audio off",
    labelUr: "آواز بند",
    patch: { voice: { output: { enabled: false, autoplay: false } } },
  },
  micro_session: {
    label: "5-minute micro-session",
    labelUr: "پانچ منٹ کا مختصر سیشن",
    patch: {
      session: { maxMinutes: 5 },
      content: { design: { missionsPerChapter: 1 } },
      policy: { rulesEnabled: { R12: false } },
    },
  },
  low_bandwidth: {
    label: "Low bandwidth",
    labelUr: "کم بینڈوڈتھ",
    patch: {
      ui: { lowBandwidth: true, reducedMotion: "on" },
      voice: { output: { enabled: false, autoplay: false } },
    },
  },
  screen_reader: {
    label: "Screen reader",
    labelUr: "اسکرین ریڈر",
    patch: {
      voice: { output: { enabled: false, autoplay: false } },
      ui: { reducedMotion: "on" },
    },
  },
};
