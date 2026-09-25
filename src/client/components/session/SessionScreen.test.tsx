import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteStrip } from "./RouteStrip";
import { Conversation, type TurnMessage } from "./Conversation";
import { Composer } from "./Composer";
import { SessionToolbar } from "./SessionToolbar";

describe("Session Screen Components", () => {
  describe("RouteStrip", () => {
    it("renders station indicator, journey title and mission title", () => {
      const html = renderToStaticMarkup(
        <RouteStrip
          currentStation={2}
          totalStations={4}
          journeyTitle="Branch Care Standards"
          missionTitle="Identity Checks"
        />,
      );

      expect(html).toContain("Station 2 of 4");
      expect(html).toContain("Branch Care Standards");
      expect(html).toContain("Identity Checks");
      expect(html).toContain('data-testid="route-strip"');
    });

    it("renders progressbar with correct accessibility attributes", () => {
      const html = renderToStaticMarkup(
        <RouteStrip currentStation={3} totalStations={5} missionTitle="Card Activation" />,
      );

      expect(html).toContain('role="progressbar"');
      expect(html).toContain('aria-valuenow="3"');
      expect(html).toContain('aria-valuemin="1"');
      expect(html).toContain('aria-valuemax="5"');
      expect(html).toContain("width:60%");
    });

    it("marks completed stations with checkmarks", () => {
      const html = renderToStaticMarkup(
        <RouteStrip currentStation={2} totalStations={3} missionTitle="Second Station" />,
      );

      expect(html).toContain("✓");
    });
  });

  describe("Conversation", () => {
    it("renders empty state when there are no turns", () => {
      const html = renderToStaticMarkup(<Conversation turns={[]} />);

      expect(html).toContain('data-testid="conversation-empty"');
      expect(html).toContain("No messages yet");
    });

    it("renders learner and tutor messages with correct labels", () => {
      const sampleTurns: TurnMessage[] = [
        {
          id: "turn-1",
          role: "tutor",
          text: "Welcome to the branch simulation.",
          lang: "en",
        },
        {
          id: "turn-2",
          role: "learner",
          text: "May I see your CNIC please?",
          lang: "en",
        },
      ];

      const html = renderToStaticMarkup(<Conversation turns={sampleTurns} />);

      expect(html).toContain("Tutor (Sana)");
      expect(html).toContain("You");
      expect(html).toContain("Welcome to the branch simulation.");
      expect(html).toContain("May I see your CNIC please?");
      expect(html).toContain('data-role="tutor"');
      expect(html).toContain('data-role="learner"');
    });

    it("sets correct language and direction on Urdu messages", () => {
      const urduTurns: TurnMessage[] = [
        {
          id: "turn-ur-1",
          role: "tutor",
          text: "خوش آمدید، میں آپ کی کیا مدد کر سکتا ہوں؟",
          lang: "ur",
          dir: "rtl",
        },
      ];

      const html = renderToStaticMarkup(<Conversation turns={urduTurns} />);

      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="ur"');
      expect(html).toContain("font-urdu");
    });

    it("renders live streaming indicator with polite aria-live attribute", () => {
      const html = renderToStaticMarkup(
        <Conversation turns={[]} isStreaming={true} streamingDelta="Thinking about account..." />,
      );

      expect(html).toContain('aria-live="polite"');
      expect(html).toContain("Thinking about account...");
      expect(html).toContain('data-testid="turn-streaming"');
    });
  });

  describe("Composer", () => {
    it("renders textarea, send button and hint button", () => {
      const html = renderToStaticMarkup(<Composer onSend={() => {}} onHint={() => {}} />);

      expect(html).toContain('data-testid="composer-input"');
      expect(html).toContain('data-testid="composer-send-btn"');
      expect(html).toContain('data-testid="composer-hint-btn"');
      expect(html).toContain("I need a hint");
      expect(html).toContain("Send");
    });

    it("renders accessible label for the input", () => {
      const html = renderToStaticMarkup(<Composer onSend={() => {}} />);

      expect(html).toContain('aria-label="Your answer"');
      expect(html).toContain('aria-label="Send reply"');
      expect(html).toContain('aria-label="Request a hint"');
    });

    it("disables buttons when loading", () => {
      const html = renderToStaticMarkup(<Composer onSend={() => {}} isLoading={true} />);

      expect(html).toContain("Sending...");
      expect(html).toContain("disabled");
    });
  });

  describe("SessionToolbar", () => {
    it("renders persona options", () => {
      const html = renderToStaticMarkup(<SessionToolbar currentPersona="branch_new_joiner" />);

      expect(html).toContain('data-testid="toolbar-persona-select"');
      expect(html).toContain("Branch new joiner");
      expect(html).toContain("Operations officer");
      expect(html).toContain("Senior manager");
    });

    it("renders language toggle group with EN, Urdu, Roman and Mixed", () => {
      const html = renderToStaticMarkup(<SessionToolbar currentLanguage="en" />);

      expect(html).toContain('data-testid="lang-btn-en"');
      expect(html).toContain('data-testid="lang-btn-ur"');
      expect(html).toContain('data-testid="lang-btn-ur-Latn"');
      expect(html).toContain('data-testid="lang-btn-mixed"');
    });

    it("renders Engine Inspector toggle button when handler provided", () => {
      const html = renderToStaticMarkup(
        <SessionToolbar onToggleInspector={() => {}} inspectorOpen={false} />,
      );

      expect(html).toContain('data-testid="toggle-inspector-btn"');
      expect(html).toContain("Inspector");
    });
  });
});
