// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import type { SttState } from "@/client/voice/useStt";
import { TalkButton } from "./TalkButton";

/**
 * The talk button is tap to start, tap again to stop and send (Nabi, 22 Sep). Holding it was
 * hard to manage, and a release the browser missed left the microphone open.
 */
const start = vi.fn(async () => undefined);
const stop = vi.fn(async () => undefined);
let hook = {
  start,
  stop,
  clear: vi.fn(),
  partial: "",
  final: "",
  detectedLang: undefined as string | undefined,
  state: "idle" as SttState,
  error: null as string | null,
  mode: "push_to_talk" as const,
};
vi.mock("@/client/voice/useStt", () => ({ useStt: () => hook }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TalkButton taps", () => {
  it("starts on the first tap, and stops and sends on the second", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onTranscript = vi.fn();
    const onTalkStart = vi.fn();
    const render = () =>
      act(async () =>
        root.render(<TalkButton onTranscript={onTranscript} onTalkStart={onTalkStart} />),
      );
    const tap = () =>
      act(async () =>
        (container.querySelector('[data-testid="talk-button"]') as HTMLButtonElement).click(),
      );

    await render();
    await tap();
    expect(start).toHaveBeenCalledTimes(1);
    expect(onTalkStart).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    hook = { ...hook, state: "listening", final: "Mera CNIC" };
    await render();
    await tap();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("Mera CNIC");
    expect(start).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
