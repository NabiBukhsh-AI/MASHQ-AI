import { expect, test as base, type Page } from "@playwright/test";

export const learner = {
  email: process.env.DEMO_LEARNER_EMAIL || "",
  password: process.env.DEMO_LEARNER_PASSWORD || "",
};

export async function ensureSignedIn(page: Page) {
  if (!learner.email) return;
  await page.goto("/login");
  await page.getByLabel("Email").fill(learner.email);
  await page.getByLabel("Password").fill(learner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/learn$/);
}

/**
 * Signs the demo learner in once per worker and shares the cookies with every test,
 * so a spec with many tests does not trip the login rate limit.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const test = base.extend<{}, { authState: string }>({
  authState: [
    async ({ browser }, provide, workerInfo) => {
      if (!learner.email) {
        await provide("");
        return;
      }
      const page = await browser.newPage({ baseURL: workerInfo.project.use.baseURL });
      await ensureSignedIn(page);
      const path = `test-results/.auth-worker-${process.pid}.json`;
      await page.context().storageState({ path });
      await page.close();
      await provide(path);
    },
    { scope: "worker" },
  ],
  storageState: async ({ authState }, provide) => {
    await provide(authState || undefined);
  },
});

/** The manager account, for the screens a learner cannot reach. */
export const manager = {
  email: process.env.DEMO_MANAGER_EMAIL || "",
  password: process.env.DEMO_MANAGER_PASSWORD || "",
};

/**
 * Signs the manager in once per worker and shares the cookies, for the same reason as the
 * learner fixture: signing in per test trips the login rate limit.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const managerTest = base.extend<{}, { managerState: string }>({
  managerState: [
    async ({ browser }, provide, workerInfo) => {
      if (!manager.email) {
        await provide("");
        return;
      }
      const page = await browser.newPage({ baseURL: workerInfo.project.use.baseURL });
      await page.goto("/login");
      await page.getByLabel("Email").fill(manager.email);
      await page.getByLabel("Password").fill(manager.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/manage$/);
      const path = `test-results/.auth-manager-${process.pid}.json`;
      await page.context().storageState({ path });
      await page.close();
      await provide(path);
    },
    { scope: "worker" },
  ],
  storageState: async ({ managerState }, provide) => {
    await provide(managerState || undefined);
  },
});

/** The admin account, for settings and system screens. */
export const admin = {
  email: process.env.DEMO_ADMIN_EMAIL || "",
  password: process.env.DEMO_ADMIN_PASSWORD || "",
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const adminTest = base.extend<{}, { adminState: string }>({
  adminState: [
    async ({ browser }, provide, workerInfo) => {
      if (!admin.email) {
        await provide("");
        return;
      }
      const page = await browser.newPage({ baseURL: workerInfo.project.use.baseURL });
      await page.goto("/login");
      await page.getByLabel("Email").fill(admin.email);
      await page.getByLabel("Password").fill(admin.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      // /admin is a redirect to the settings screen, so the landing URL is /admin/config.
      await expect(page).toHaveURL(/\/admin(\/config)?$/);
      const path = `test-results/.auth-admin-${process.pid}.json`;
      await page.context().storageState({ path });
      await page.close();
      await provide(path);
    },
    { scope: "worker" },
  ],
  storageState: async ({ adminState }, provide) => {
    await provide(adminState || undefined);
  },
});

export const choiceUi = {
  kind: "choice",
  questionId: "q1",
  prompt: "Mr. Rasheed has arrived. What do you do first?",
  options: [
    {
      id: "a",
      label: { en: "Greet him and offer a seat", ur: "سلام کریں", urLatn: "Salam karein" },
    },
    { id: "b", label: { en: "Start typing his request", ur: "ٹائپ کریں", urLatn: "Type karein" } },
    { id: "c", label: { en: "Ask him to wait", ur: "انتظار", urLatn: "Intezar" } },
  ],
};

export const sequenceUi = {
  kind: "sequence",
  questionId: "q2",
  prompt: "Put the first-minute steps in order.",
  steps: [
    { id: "s_confirm", label: { en: "Confirm what you heard", ur: "", urLatn: "" } },
    { id: "s_greet", label: { en: "Greet within thirty seconds", ur: "", urLatn: "" } },
    { id: "s_listen", label: { en: "Listen fully", ur: "", urLatn: "" } },
    { id: "s_cnic", label: { en: "Ask for the original CNIC", ur: "", urLatn: "" } },
  ],
};

export const matchUi = {
  kind: "match",
  questionId: "q3",
  prompt: "Match each term to its meaning.",
  lefts: [
    { en: "CNIC", ur: "", urLatn: "" },
    { en: "IBAN", ur: "", urLatn: "" },
  ],
  rights: [
    { en: "Bank account number", ur: "", urLatn: "" },
    { en: "National identity card", ur: "", urLatn: "" },
  ],
};

export const spotErrorUi = {
  kind: "spot_error",
  questionId: "q4",
  prompt: "Which sentence breaks the standard?",
  sentences: [
    { id: "t1", text: { en: "Greet the customer within thirty seconds.", ur: "", urLatn: "" } },
    { id: "t2", text: { en: "Accept a photocopy of the CNIC.", ur: "", urLatn: "" } },
    { id: "t3", text: { en: "Confirm what you heard.", ur: "", urLatn: "" } },
  ],
};

export const teachBackUi = {
  kind: "teach_back",
  questionId: "q5",
  prompt: "Explain the first minute to a new colleague.",
};

/** GET /api/sessions/[id] stub. `started: true` stops the page from auto-opening the mission. */
export function sessionBody(id: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionId: id,
    orgId: "org-mock",
    userId: "user-mock",
    journeyId: "journey-mock-1",
    journeyTitle: "Branch Counter Care",
    currentMissionId: "m-1",
    currentMission: { id: "m-1", title: "The First Minute", ordinal: 0, chapterKey: "ch_counter" },
    personaId: "branch_new_joiner",
    language: "en",
    presets: [],
    status: "active",
    turns: [],
    totalMissions: 3,
    ui: null,
    progress: { started: true, finished: false, completed: 0, total: 3 },
    ...overrides,
  };
}

export async function mockSession(page: Page, id: string, overrides: Record<string, unknown> = {}) {
  await page.route(`**/api/sessions/${id}/controls`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    const applied = Object.entries(body)
      .filter(([, v]) => v)
      .map(([kind, to]) => ({ kind, to, reason: `Panel switched ${kind} to ${to}.` }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        applied,
        language: body.language ?? "en",
        personaId: body.persona ?? "branch_new_joiner",
      }),
    });
  });
  await page.route(`**/api/sessions/${id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sessionBody(id, overrides)),
    });
  });
}

export function sse(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

/** A complete tutor turn as the engine would stream it. */
export function tutorTurn(
  text: string,
  extra: unknown[] = [],
  turnId = "t-mock",
  /** Extra fields on every display.sentence, such as the unverified figures it carries. */
  sentenceExtra: Record<string, unknown> = {},
) {
  const sentences = text.split(/(?<=[.?!])\s+/);
  return [
    { type: "turn.start", turnId, moveTypes: ["feedback_correct"] },
    ...sentences.flatMap((s, i) => [
      { type: "display.delta", text: (i ? " " : "") + s },
      { type: "display.sentence", index: i, text: s, ...sentenceExtra },
    ]),
    ...extra,
    { type: "turn.end", turnId, timings: { ttftMs: 900, latencyMs: 2100 } },
    { type: "end" },
  ];
}

export interface TurnBody {
  input: { mode: string; text?: string; answer?: unknown };
}

/** POST /api/sessions/[id]/turns stub; records every request body for assertions. */
export async function mockTurns(page: Page, id: string, respond: (body: TurnBody) => unknown[]) {
  const bodies: TurnBody[] = [];
  await page.route(`**/api/sessions/${id}/turns`, async (route) => {
    const body = route.request().postDataJSON() as TurnBody;
    bodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse(respond(body)),
    });
  });
  return bodies;
}
