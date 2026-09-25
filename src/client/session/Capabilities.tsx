"use client";

import React, { createContext, useContext } from "react";
import type { Role } from "@/server/auth/guards";

/**
 * What this signed in person is allowed to do, resolved on the server and handed to the client.
 *
 * The upload controls used to render for everyone. A learner in an organization that has turned
 * content.learnerUploads off could drag a file in, wait for it to parse, and then be told no by
 * the API. Refusing in the route is the security boundary and stays; this stops the UI offering
 * something the server will refuse.
 *
 * This is presentation only. Nothing here is a permission check: the routes do that.
 */
export interface Capabilities {
  role: Role;
  /** May add new content: managers and admins always, learners only when config allows it. */
  canUpload: boolean;
}

const CapabilitiesContext = createContext<Capabilities | null>(null);

export function CapabilitiesProvider({
  value,
  children,
}: {
  value: Capabilities;
  children: React.ReactNode;
}): React.JSX.Element {
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

/** Defaults to a learner who cannot upload, so a missing provider hides rather than reveals. */
export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext) ?? { role: "learner", canUpload: false };
}
