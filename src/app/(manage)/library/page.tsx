"use client";

import React, { useState } from "react";
import { QuickStart } from "@/client/components/QuickStart";
import { ContentLibraryTable } from "@/client/components/ContentLibraryTable";
import { useStartPractice } from "@/client/session/useStartPractice";

/**
 * Where an L&D manager adds the material learners practise, and sees everything already added.
 *
 * The intake is QuickStart, the same one /learn uses, so there is one path in. The list below
 * is the organization's real content; it used to be a hardcoded "Sample Document".
 */
export default function LibraryPage() {
  // Bumped when an upload finishes, so the new document appears without a reload.
  const [refreshKey, setRefreshKey] = useState(0);
  // QuickStart was rendered here without a start handler, so "Start Mission 1" did nothing.
  const practice = useStartPractice();

  return (
    <div className="mx-auto w-full max-w-5xl p-8">
      <h1 className="text-ink mb-1 text-2xl font-bold">Content library</h1>
      <p className="text-ink/70 mb-6 text-sm">
        Add a document, paste text or import a link. Learners practise what you publish here.
      </p>
      <QuickStart
        onPlayable={() => setRefreshKey((k) => k + 1)}
        onStartMission={(journeyId, _missionId, options) => void practice.start(journeyId, options)}
      />
      {practice.error && (
        <p role="alert" className="text-kattha mt-3 text-sm" data-testid="start-session-error">
          {practice.error}
        </p>
      )}
      {practice.starting && (
        <p role="status" className="text-neem mt-3 text-sm">
          Opening the practice session...
        </p>
      )}
      <ContentLibraryTable refreshKey={refreshKey} />
    </div>
  );
}
