import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TalkButton } from "./TalkButton";
import type { SttState, SttMode } from "@/client/voice/useStt";

// Mock useStt hook
const mockStart = vi.fn(async () => undefined);
const mockStop = vi.fn(async () => undefined);
const mockClear = vi.fn();

let mockHookState: {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  partial: string;
  final: string;
  detectedLang: string | undefined;
  state: SttState;
  error: string | null;
  mode: SttMode;
  setMode: (mode: SttMode) => void;
} = {
  start: mockStart,
  stop: mockStop,
  clear: mockClear,
  partial: "",
  final: "",
  detectedLang: "ur",
  state: "idle",
  error: null,
  mode: "push_to_talk",
  setMode: vi.fn(),
};

vi.mock("@/client/voice/useStt", () => ({
  useStt: () => mockHookState,
}));

describe("TalkButton Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHookState = {
      start: mockStart,
      stop: mockStop,
      clear: mockClear,
      partial: "",
      final: "",
      detectedLang: "ur",
      state: "idle",
      error: null,
      mode: "push_to_talk",
      setMode: vi.fn(),
    };
  });

  it("renders idle state with accessible attributes and label", () => {
    const html = renderToStaticMarkup(<TalkButton onTranscript={() => undefined} />);

    expect(html).toContain('data-testid="talk-button"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Tap to speak, tap again to send. Or press Spacebar.");
    expect(html).toContain("Tap to speak");
  });

  it("renders active listening state with animate-pulse and listening text", () => {
    mockHookState = {
      ...mockHookState,
      state: "listening" as const,
      partial: "Pehle CNIC...",
    };

    const html = renderToStaticMarkup(<TalkButton onTranscript={() => undefined} />);

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Listening. Tap again to send your answer.");
    expect(html).toContain("Listening... tap to send");
    expect(html).toContain('data-testid="stt-live-caption"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Pehle CNIC...");
  });

  it("renders error alert notice when speech recognition errors out", () => {
    mockHookState = {
      ...mockHookState,
      state: "error" as const,
      error:
        "Microphone access was denied. Please allow microphone access in your browser or use the text reply box.",
    };

    const html = renderToStaticMarkup(<TalkButton onTranscript={() => undefined} />);

    expect(html).toContain('data-testid="stt-error-alert"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Microphone access was denied");
  });

  it("says a pause also sends in hands free", () => {
    const idle = renderToStaticMarkup(
      <TalkButton onTranscript={() => undefined} mode="hands_free" />,
    );
    expect(idle).toContain("Your answer is sent when you pause.");

    mockHookState = { ...mockHookState, state: "listening" as const };
    const listening = renderToStaticMarkup(
      <TalkButton onTranscript={() => undefined} mode="hands_free" />,
    );
    expect(listening).toContain("Listening... tap to send");
    expect(listening).toContain("Pause or tap again to send your answer.");
  });

  it("renders disabled state when disabled prop is set", () => {
    const html = renderToStaticMarkup(
      <TalkButton onTranscript={() => undefined} disabled={true} />,
    );

    expect(html).toContain("disabled");
  });
});
