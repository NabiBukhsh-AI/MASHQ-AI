"use client";

import React, { useState, useRef, useEffect } from "react";
import type { IngestTelemetry, PipelineStageInfo } from "./Inspector/IngestTab";
import type { JourneyChapter } from "./JourneyMap";
import { useCapabilities } from "@/client/session/Capabilities";

export interface QuickStartProps {
  onPlayable?: (result: { journeyId: string; missionId: string; elapsedMs: number }) => void;
  onStartMission?: (
    journeyId: string,
    missionId: string,
    options: { personaId: string; language: string },
  ) => void;
  onTelemetryUpdate?: (telemetry: IngestTelemetry) => void;
  onJourneyUpdate?: (journey: {
    title?: string;
    summary?: string;
    chapters: JourneyChapter[];
  }) => void;
}

const DEFAULT_STAGES: PipelineStageInfo[] = [
  { stage: "intake", name: "Intake and format parsing", status: "pending" },
  { stage: "redact", name: "PII and identifier redaction", status: "pending" },
  { stage: "scan", name: "Prompt injection heuristics", status: "pending" },
  { stage: "chunk", name: "Language detection and chunking", status: "pending" },
  { stage: "outline", name: "Concepts and journey outline", status: "pending" },
  { stage: "facts", name: "Facts and quote verification", status: "pending" },
  { stage: "mission", name: "Mission pack 1 generation", status: "pending" },
];

export const PERSONA_OPTIONS = [
  { id: "branch_new_joiner", label: "Branch new joiner", labelUr: "برانچ کا نیا ساتھی" },
  { id: "branch_officer", label: "Branch officer", labelUr: "برانچ افسر" },
  { id: "back_office_specialist", label: "Back office specialist", labelUr: "بیک آفس ماہر" },
  { id: "senior_manager", label: "Senior manager", labelUr: "سینئر مینیجر" },
];

export const LANGUAGE_OPTIONS = [
  { id: "en", label: "English" },
  { id: "ur", label: "اردو (Urdu)" },
  { id: "ur-Latn", label: "Roman Urdu" },
];

/**
 * What the material itself is written in. Auto leaves it to detection. It sets the default
 * practice language below, and the practice language is what picks the tutor's voice: English
 * goes to the English voice, Urdu to an Urdu voice, and Roman Urdu is rendered into Urdu
 * script for an Urdu voice rather than read out letter by letter by an English one.
 */
export const CONTENT_LANGUAGE_OPTIONS = [
  { id: "auto", label: "Auto (detect from the text)" },
  { id: "en", label: "English" },
  { id: "ur", label: "اردو (Urdu)" },
  { id: "ur-Latn", label: "Roman Urdu" },
];

export function QuickStart({
  onPlayable,
  onStartMission,
  onTelemetryUpdate,
  onJourneyUpdate,
}: QuickStartProps): React.JSX.Element {
  // Resolved on the server from the person's role and content.learnerUploads.
  const { canUpload } = useCapabilities();
  const [activeTab, setActiveTab] = useState<"file" | "paste" | "url">("paste");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [personaId, setPersonaId] = useState("branch_new_joiner");
  const [language, setLanguage] = useState("en");
  const [contentLanguage, setContentLanguage] = useState("auto");

  // State machine
  const [status, setStatus] = useState<
    "idle" | "uploading" | "processing" | "playable" | "done" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playableData, setPlayableData] = useState<{
    journeyId: string;
    missionId: string;
    elapsedMs: number;
  } | null>(null);

  // Telemetry state
  const [telemetry, setTelemetry] = useState<IngestTelemetry>({
    stages: DEFAULT_STAGES,
    elapsedMs: 0,
    redactionsCount: 0,
    injectionFlagsCount: 0,
    scannedPageCount: 0,
    warnings: [],
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onTelemetryUpdate?.(telemetry);
  }, [telemetry, onTelemetryUpdate]);

  const updateStage = (stageKey: string, updates: Partial<PipelineStageInfo>) => {
    setTelemetry((prev) => ({
      ...prev,
      stages: prev.stages.map((s) => (s.stage === stageKey ? { ...s, ...updates } : s)),
    }));
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setIsDragging(true);
    else if (e.type === "dragleave") setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const startPipeline = async () => {
    setStatus("uploading");
    setErrorMessage(null);
    setPlayableData(null);

    // Reset stages
    setTelemetry({
      stages: DEFAULT_STAGES.map((s) => ({
        ...s,
        status: "pending",
        durationMs: undefined,
        message: undefined,
      })),
      elapsedMs: 0,
      redactionsCount: 0,
      injectionFlagsCount: 0,
      scannedPageCount: 0,
      warnings: [],
      reused: false,
    });

    const startTime = performance.now();
    if (contentLanguage !== "auto") setLanguage(contentLanguage);

    try {
      let contentId = "";
      let reused = false;

      // 1. Submit to /api/content
      if (activeTab === "file") {
        if (!file) throw new Error("Please select a file to upload.");
        const formData = new FormData();
        formData.append("file", file);
        if (docTitle.trim()) formData.append("title", docTitle.trim());
        formData.append("language", contentLanguage);

        const res = await fetch("/api/content", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Upload failed with status ${res.status}`);
        }
        const data = await res.json();
        contentId = data.contentId;
        reused = Boolean(data.reused);
      } else if (activeTab === "paste") {
        if (!pasteText.trim()) throw new Error("Please paste some text content.");
        const res = await fetch("/api/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "paste",
            text: pasteText,
            title: docTitle.trim() || undefined,
            language: contentLanguage,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Submit failed with status ${res.status}`);
        }
        const data = await res.json();
        contentId = data.contentId;
        reused = Boolean(data.reused);
      } else {
        if (!articleUrl.trim()) throw new Error("Please enter a valid URL.");
        const res = await fetch("/api/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "url",
            url: articleUrl.trim(),
            language: contentLanguage,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `URL fetch failed with status ${res.status}`);
        }
        const data = await res.json();
        contentId = data.contentId;
        reused = Boolean(data.reused);
      }

      if (reused) {
        setTelemetry((prev) => ({ ...prev, reused: true }));
      }

      // 2. Stream pipeline SSE from /api/content/[contentId]/design
      // Guarded: reading the wrong field off the intake response put the literal string
      // "undefined" in this URL, and the failure surfaced one stage later as "designing the
      // journey failed", which points at the model rather than at the id that was never read.
      if (!contentId) {
        throw new Error(
          "The upload succeeded but did not return a content id, so the journey cannot be designed. Try again.",
        );
      }
      setStatus("processing");
      abortControllerRef.current = new AbortController();

      const sseRes = await fetch(`/api/content/${contentId}/design`, {
        signal: abortControllerRef.current.signal,
      });

      if (!sseRes.ok) {
        const err = await sseRes.json().catch(() => ({}));
        throw new Error(
          err.error?.message || `Design pipeline failed with status ${sseRes.status}`,
        );
      }

      const reader = sseRes.body?.getReader();
      if (!reader) throw new Error("Readable stream not available");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const rawData = line.slice(6).trim();
            if (!rawData) continue;

            let parsedData: {
              stage?: string;
              name?: string;
              message?: string;
              ms?: number;
              title?: string;
              chapters?: number;
              concepts?: number;
              missions?: number;
              journeyId?: string;
              missionId?: string;
              elapsedMs?: number;
              id?: string;
              ordinal?: number;
              key?: string;
              /** Sent with the prepare stage: the document's language, set or detected. */
              language?: string;
            } = {};
            try {
              parsedData = JSON.parse(rawData);
            } catch {
              parsedData = { message: rawData };
            }

            const elapsed = performance.now() - startTime;
            setTelemetry((prev) => ({ ...prev, elapsedMs: Math.round(elapsed) }));

            if (currentEvent === "stage.start" && parsedData.stage) {
              updateStage(parsedData.stage, { status: "running", message: parsedData.name });
            } else if (currentEvent === "stage.progress" && parsedData.stage) {
              updateStage(parsedData.stage, { message: parsedData.message });
            } else if (currentEvent === "stage.done" && parsedData.stage) {
              updateStage(parsedData.stage, { status: "done", durationMs: parsedData.ms });
              if (
                parsedData.stage === "prepare" &&
                typeof parsedData.language === "string" &&
                LANGUAGE_OPTIONS.some((l) => l.id === parsedData.language)
              ) {
                setLanguage(parsedData.language);
              }
            } else if (currentEvent === "outline.partial") {
              updateStage("outline", {
                status: "running",
                message: `Found ${parsedData.concepts || 0} concepts`,
              });
              if (onJourneyUpdate) {
                const chapters: JourneyChapter[] = [
                  {
                    key: "ch_main",
                    title: parsedData.title || "Main Journey",
                    missions: Array.from({ length: parsedData.missions || 1 }, (_, i) => ({
                      key: `m_${i + 1}`,
                      ordinal: i,
                      title: `Mission ${i + 1}`,
                      status: i === 0 ? "ready" : "pending",
                    })),
                  },
                ];
                onJourneyUpdate({
                  title: parsedData.title,
                  chapters,
                });
              }
            } else if (currentEvent === "mission.ready") {
              updateStage("mission", { status: "done" });
            } else if (
              currentEvent === "playable" &&
              parsedData.journeyId &&
              parsedData.missionId
            ) {
              const pInfo = {
                journeyId: parsedData.journeyId,
                missionId: parsedData.missionId,
                elapsedMs: parsedData.elapsedMs || Math.round(elapsed),
              };
              setPlayableData(pInfo);
              setStatus("playable");
              onPlayable?.(pInfo);
            } else if (currentEvent === "done") {
              setStatus((prev) => (prev === "playable" ? "playable" : "done"));
            } else if (currentEvent === "warning") {
              setTelemetry((prev) => ({
                ...prev,
                warnings: [...prev.warnings, parsedData.message || JSON.stringify(parsedData)],
              }));
            } else if (currentEvent === "error") {
              throw new Error(parsedData.message || "Pipeline error");
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="border-mist rounded-xl border bg-white p-6 font-sans shadow-sm"
      data-testid="quickstart-form"
    >
      <div className="border-mist mb-5 border-b pb-4">
        <h2 className="text-ink text-xl font-bold">Start Practising</h2>
        <p className="text-ink/70 mt-1 text-sm">
          {canUpload
            ? "Upload bank policy, paste text or submit a URL to instantly generate an interactive practice journey."
            : "Pick a journey your L&D team has published, and practise it as a guided session."}
        </p>
      </div>

      {!canUpload && (
        <div
          role="status"
          data-testid="uploads-disabled-note"
          className="border-mist bg-paper/60 text-ink/70 mb-5 rounded-lg border p-3 text-sm"
        >
          Adding new material is handled by your L&D team for this organization. Your journeys
          appear here once they publish them.
        </div>
      )}

      {/* Input Mode Selector Tabs. Hidden when the server would refuse the upload anyway: a
          control that always fails is worse than no control. The route is still the boundary. */}
      {canUpload && (
        <div className="border-mist mb-5 flex border-b" role="tablist" aria-label="Input types">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "paste"}
            onClick={() => setActiveTab("paste")}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "paste"
                ? "border-neem text-neem"
                : "text-ink/70 hover:text-ink border-transparent"
            }`}
            data-testid="tab-paste"
          >
            Paste Text
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "file"}
            onClick={() => setActiveTab("file")}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "file"
                ? "border-neem text-neem"
                : "text-ink/70 hover:text-ink border-transparent"
            }`}
            data-testid="tab-file"
          >
            Upload Document
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "url"}
            onClick={() => setActiveTab("url")}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "url"
                ? "border-neem text-neem"
                : "text-ink/70 hover:text-ink border-transparent"
            }`}
            data-testid="tab-url"
          >
            Article URL
          </button>
        </div>
      )}

      {/* Mode 1: Document Upload */}
      {canUpload && activeTab === "file" && (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="doc-title-input"
              className="text-ink/70 block text-xs font-semibold tracking-wider uppercase"
            >
              Optional Document Title
            </label>
            <input
              id="doc-title-input"
              type="text"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="e.g. Branch Care and Compliance Standards"
              className="border-mist text-ink placeholder:text-ink/40 focus:border-neem focus:ring-neem mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
              data-testid="file-title-input"
            />
          </div>

          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragging
                ? "border-neem bg-neem/5"
                : file
                  ? "border-neem/50 bg-paper/50"
                  : "border-mist bg-paper/20 hover:bg-paper/40"
            }`}
            data-testid="dropzone"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.pptx,.txt,.md"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Upload document file"
              data-testid="file-input"
            />

            {file ? (
              <div className="space-y-2">
                <p className="text-ink text-sm font-semibold" data-testid="selected-filename">
                  {file.name}
                </p>
                <p className="text-ink/70 text-xs">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-kattha hover:text-kattha/80 text-xs underline"
                >
                  Choose another file
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-ink/80 text-sm">
                  Drag and drop a PDF, DOCX, PPTX or text file here, or
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-mist text-ink hover:bg-paper focus:ring-neem rounded-lg border bg-white px-4 py-2 text-sm font-medium shadow-sm focus:ring-2 focus:outline-none"
                  data-testid="browse-button"
                >
                  Browse Files
                </button>
                <p className="text-ink/70 text-xs">
                  Supported formats: PDF, DOCX, PPTX, TXT, MD (up to 4MB)
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode 2: Paste Text */}
      {canUpload && activeTab === "paste" && (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="paste-title-input"
              className="text-ink/70 block text-xs font-semibold tracking-wider uppercase"
            >
              Document Title
            </label>
            <input
              id="paste-title-input"
              type="text"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="e.g. Branch Customer Verification Protocol"
              className="border-mist text-ink placeholder:text-ink/40 focus:border-neem focus:ring-neem mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
              data-testid="paste-title-input"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="paste-textarea"
                className="text-ink/70 block text-xs font-semibold tracking-wider uppercase"
              >
                Text Content
              </label>
              <span className="text-ink/70 text-xs" data-testid="char-counter">
                {pasteText.length} characters
              </span>
            </div>
            <textarea
              id="paste-textarea"
              rows={6}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste training document, policy guidelines or notes here..."
              className="border-mist text-ink placeholder:text-ink/40 focus:border-neem focus:ring-neem mt-1 w-full rounded-lg border p-3 text-sm focus:ring-1 focus:outline-none"
              data-testid="paste-textarea"
            />
          </div>
        </div>
      )}

      {/* Mode 3: Article URL */}
      {canUpload && activeTab === "url" && (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="url-input"
              className="text-ink/70 block text-xs font-semibold tracking-wider uppercase"
            >
              Article or Policy URL
            </label>
            <input
              id="url-input"
              type="url"
              value={articleUrl}
              onChange={(e) => setArticleUrl(e.target.value)}
              placeholder="https://example.com/banking-policy"
              className="border-mist text-ink placeholder:text-ink/40 focus:border-neem focus:ring-neem mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
              data-testid="url-input"
            />
            <p className="text-ink/70 mt-1 text-xs">
              Only public HTTP/HTTPS URLs are supported. Internal and localhost addresses are
              rejected.
            </p>
          </div>
        </div>
      )}

      {/* The material's own language. Only offered to someone who can add content. */}
      {canUpload && (
        <div className="mt-5">
          <label
            htmlFor="content-language-select"
            className="text-ink/70 block text-xs font-semibold tracking-wider uppercase"
          >
            Language of this material
          </label>
          <select
            id="content-language-select"
            value={contentLanguage}
            onChange={(e) => setContentLanguage(e.target.value)}
            className="border-mist text-ink focus:border-neem focus:ring-neem mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            data-testid="content-language-select"
            aria-describedby="content-language-help"
          >
            {CONTENT_LANGUAGE_OPTIONS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <p id="content-language-help" className="text-ink/70 mt-1 text-xs">
            Sets the tutor&apos;s voice. English uses the English voice; Urdu and Roman Urdu use an
            Urdu voice. Auto reads the language from the text.
          </p>
        </div>
      )}

      {/* Configuration Selectors: Persona & Language */}
      <div className="border-mist mt-6 grid gap-4 border-t pt-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="persona-select"
            className="text-ink/70 block text-xs font-semibold tracking-wider uppercase"
          >
            Learner Persona
          </label>
          <select
            id="persona-select"
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            className="border-mist text-ink focus:border-neem focus:ring-neem mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            data-testid="persona-select"
          >
            {PERSONA_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.labelUr})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="language-select"
            className="text-ink/70 block text-xs font-semibold tracking-wider uppercase"
          >
            Practice Language
          </label>
          <select
            id="language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="border-mist text-ink focus:border-neem focus:ring-neem mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            data-testid="language-select"
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error Banner */}
      {status === "error" && errorMessage && (
        <div
          className="border-kattha/30 bg-kattha/10 text-kattha mt-4 rounded-lg border p-3 text-xs"
          data-testid="error-banner"
        >
          <p className="font-semibold">Pipeline Error</p>
          <p>{errorMessage}</p>
        </div>
      )}

      {/* Actions */}
      <div className="border-mist mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {status === "playable" && playableData ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="text-ink/80 text-xs">
              <span className="text-neem font-semibold">Ready to practice!</span> Time to playable:{" "}
              <span className="text-ink font-bold">
                {(playableData.elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                onStartMission?.(playableData.journeyId, playableData.missionId, {
                  personaId,
                  language,
                })
              }
              className="bg-neem hover:bg-neem/90 focus:ring-neem rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm focus:ring-2 focus:ring-offset-2 focus:outline-none"
              data-testid="start-mission-button"
            >
              Start Mission 1
            </button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-end">
            <button
              type="button"
              disabled={
                status === "uploading" ||
                status === "processing" ||
                (activeTab === "paste" && !pasteText.trim()) ||
                (activeTab === "file" && !file) ||
                (activeTab === "url" && !articleUrl.trim())
              }
              onClick={startPipeline}
              className="bg-neem hover:bg-neem/90 focus:ring-neem inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="submit-button"
            >
              {status === "uploading" || status === "processing" ? (
                <>
                  <span className="me-2 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Generating Journey...
                </>
              ) : (
                "Generate Practice Journey"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
