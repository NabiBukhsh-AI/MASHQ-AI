import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { intake, sourceHashOf, type IntakeDeps } from "./intake";
import type { IntakeRepo, NewContentInput } from "./repo";
import { DEFAULT_CONFIG } from "../config/defaults";
import { deepMerge } from "../config/merge";
import { AppError } from "../http/errors";
import type { Config } from "../config/schema";

const fixtures = path.resolve(process.cwd(), "eval/fixtures/intake");
const read = (name: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));
const actor = { orgId: "org-1", userId: "user-1", role: "ld_manager" as const };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function fakeDeps(configPatch: Record<string, unknown> = {}) {
  const created: NewContentInput[] = [];
  const existing = new Map<string, { contentId: string; jobId: string }>();
  const repo: IntakeRepo = {
    findByHash: vi.fn(async (_org, hash) => {
      const hit = existing.get(hash);
      return hit ? { ...hit, stats: null, warnings: ["seen before"] } : null;
    }),
    create: vi.fn(async (input) => {
      created.push(input);
      const ids = { contentId: `c-${created.length}`, jobId: `j-${created.length}` };
      existing.set(input.sourceHash, ids);
      return { ...ids, reused: false };
    }),
  };
  const config = deepMerge(DEFAULT_CONFIG, configPatch) as Config;
  const deps: IntakeDeps = { repo, loadConfig: async () => ({ config }) };
  return { deps, created, repo };
}

async function rejects(p: Promise<unknown>, status: number, re: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
  expect((err as AppError).publicMessage).toMatch(re);
}

describe("intake: fixtures", () => {
  it("stores a valid PDF as a content row plus a queued job carrying the parsed doc", async () => {
    const { deps, created } = fakeDeps();
    const r = await intake(
      {
        kind: "upload",
        bytes: read("tiny.pdf"),
        mimeType: "application/pdf",
        filename: "tiny.pdf",
      },
      actor,
      deps,
    );
    expect(r).toMatchObject({ contentId: "c-1", jobId: "j-1", reused: false });
    expect(r.stats.pages).toBe(1);
    expect(r.stats.chars).toBeGreaterThan(0);
    expect(created[0]).toMatchObject({
      orgId: "org-1",
      ownerId: "user-1",
      sourceType: "pdf",
      parserVersion: "v1",
    });
    expect(created[0]!.doc.text).toContain("Hello Mashq PDF Test");
    expect(created[0]!.sourceHash).toBe(sourceHashOf(created[0]!.doc.text));
  });

  it("parses DOCX", async () => {
    const { deps, created } = fakeDeps();
    await intake(
      { kind: "upload", bytes: read("sample.docx"), mimeType: DOCX, filename: "sample.docx" },
      actor,
      deps,
    );
    expect(created[0]!.doc.text).toContain("Banking Guidelines");
    expect(created[0]!.sourceType).toBe("docx");
    // Plain text, not markdown-escaped: identifiers must stay matchable by redaction.
    expect(created[0]!.doc.text).not.toMatch(/\[.()-]/);
    expect(created[0]!.doc.text).toContain("account requests.");
  });

  it("parses PPTX with slide order and notes", async () => {
    const { deps, created } = fakeDeps();
    const r = await intake(
      { kind: "upload", bytes: read("sample.pptx"), mimeType: PPTX, filename: "sample.pptx" },
      actor,
      deps,
    );
    expect(r.stats.slides).toBe(2);
    const blocks = created[0]!.doc.blocks;
    expect(blocks[0]?.heading).toBe("Customer Service Onboarding");
    expect(blocks[0]?.notes).toContain("Remind learners about polite Urdu greetings");
    expect(blocks[1]?.heading).toBe("Step 2: Verification");
  });

  it("rejects an encrypted PDF with the password message", async () => {
    const { deps } = fakeDeps();
    await rejects(
      intake(
        {
          kind: "upload",
          bytes: read("encrypted.pdf"),
          mimeType: "application/pdf",
          filename: "encrypted.pdf",
        },
        actor,
        deps,
      ),
      400,
      /password protected. Remove the password or paste the text/,
    );
  });

  it("rejects a zip bomb before extraction", async () => {
    const { deps, created } = fakeDeps();
    await rejects(
      intake(
        { kind: "upload", bytes: read("zipbomb.zip"), mimeType: DOCX, filename: "bomb.docx" },
        actor,
        deps,
      ),
      400,
      /zip bomb.*rejected before extraction/i,
    );
    expect(created).toHaveLength(0);
  });

  it("rejects wrong magic bytes with a clear message", async () => {
    const { deps } = fakeDeps();
    await rejects(
      intake(
        {
          kind: "upload",
          bytes: read("bad-magic.pdf"),
          mimeType: "application/pdf",
          filename: "bad.pdf",
        },
        actor,
        deps,
      ),
      400,
      /does not look like the type/,
    );
  });

  it("rejects NUL-byte text", async () => {
    const { deps } = fakeDeps();
    await rejects(
      intake(
        {
          kind: "upload",
          bytes: read("nul-byte.txt"),
          mimeType: "text/plain",
          filename: "nul.txt",
        },
        actor,
        deps,
      ),
      400,
      /does not look like|binary data/i,
    );
  });
});

describe("intake: caps and config gates", () => {
  it("rejects a body over the configured size with the paste or large-file guidance (413)", async () => {
    const { deps, created } = fakeDeps();
    const huge = new Uint8Array(4 * 1024 * 1024 + 1);
    await rejects(
      intake(
        { kind: "upload", bytes: huge, mimeType: "application/pdf", filename: "big.pdf" },
        actor,
        deps,
      ),
      413,
      /4 MB limit.*paste/i,
    );
    await rejects(
      intake({ kind: "paste", text: "x".repeat(4 * 1024 * 1024 + 1) }, actor, deps),
      413,
      /4 MB/,
    );
    expect(created).toHaveLength(0);
  });

  it("honours content.maxUploadMB from config", async () => {
    const { deps } = fakeDeps({ content: { maxUploadMB: 1 } });
    await rejects(
      intake({ kind: "paste", text: "x".repeat(1024 * 1024 + 1) }, actor, deps),
      413,
      /1 MB/,
    );
  });

  it("blocks learner uploads when content.learnerUploads is off, allows managers", async () => {
    const { deps } = fakeDeps({ content: { learnerUploads: false } });
    await rejects(
      intake({ kind: "paste", text: "hello" }, { ...actor, role: "learner" }, deps),
      403,
      /turned off/,
    );
    await expect(intake({ kind: "paste", text: "hello" }, actor, deps)).resolves.toMatchObject({
      reused: false,
    });
  });

  it("rejects file types outside content.allowedTypes", async () => {
    const { deps } = fakeDeps({ content: { allowedTypes: ["pdf", "paste"] } });
    await rejects(
      intake(
        { kind: "upload", bytes: read("sample.docx"), mimeType: DOCX, filename: "sample.docx" },
        actor,
        deps,
      ),
      400,
      /not supported here/,
    );
  });

  it("rejects content over content.maxChars", async () => {
    const { deps } = fakeDeps({ content: { maxChars: 1000 } });
    await rejects(
      intake({ kind: "paste", text: "word ".repeat(300) }, actor, deps),
      400,
      /1,000 character limit/,
    );
  });

  it("rejects empty text", async () => {
    const { deps } = fakeDeps();
    await rejects(intake({ kind: "paste", text: "   \n  " }, actor, deps), 400, /No readable text/);
  });
});

describe("intake: paste, parsed, dedupe", () => {
  it("stores pasted text with the given title", async () => {
    const { deps, created } = fakeDeps();
    const r = await intake(
      {
        kind: "paste",
        text: "Pasted content for learning customer support.",
        title: "Customer Care",
      },
      actor,
      deps,
    );
    expect(r.reused).toBe(false);
    expect(created[0]).toMatchObject({ title: "Customer Care", sourceType: "paste" });
  });

  it("stores a client-parsed document and maps html to url", async () => {
    const { deps, created } = fakeDeps();
    await intake(
      {
        kind: "parsed",
        doc: {
          title: "Article",
          sourceType: "html",
          blocks: [{ kind: "url", ref: "https://x.test/a", text: "Body." }],
          text: "Body.",
        },
        sourceUrl: "https://x.test/a",
      },
      actor,
      deps,
    );
    expect(created[0]).toMatchObject({ sourceType: "url", sourceUrl: "https://x.test/a" });
  });

  it("returns reused for the same text in the same org and never stores twice", async () => {
    const { deps, created } = fakeDeps();
    const first = await intake({ kind: "paste", text: "Same text twice." }, actor, deps);
    const second = await intake({ kind: "paste", text: "Same text twice.  " }, actor, deps);
    expect(second).toMatchObject({
      contentId: first.contentId,
      jobId: first.jobId,
      reused: true,
      warnings: ["seen before"],
    });
    expect(created).toHaveLength(1);
  });

  it("derives a title from the filename or the first line", async () => {
    const { deps, created } = fakeDeps();
    await intake({ kind: "paste", text: "Branch opening checklist\nStep one." }, actor, deps);
    expect(created[0]!.title).toBe("Branch opening checklist");
  });
});

describe.skipIf(!process.env.LIVE_DB)("intake: live storage", () => {
  it("writes contents and ingest_jobs rows for the demo org and cleans up", async () => {
    const { eq } = await import("drizzle-orm");
    const { db } = await import("../db/client");
    const s = await import("../db/schema");
    const { dbIntakeRepo } = await import("./repo");
    const [org] = await db
      .select({ id: s.organizations.id })
      .from(s.organizations)
      .where(eq(s.organizations.slug, "demo-bank"));
    const [owner] = await db
      .select({ id: s.user.id })
      .from(s.user)
      .where(eq(s.user.orgId, org!.id))
      .limit(1);
    const text = `Live intake test ${Date.now()}\nA second line.`;
    const deps: IntakeDeps = {
      repo: dbIntakeRepo(db),
      loadConfig: async () => ({ config: DEFAULT_CONFIG }),
    };
    const live = { orgId: org!.id, userId: owner!.id, role: "admin" as const };
    const r = await intake({ kind: "paste", text }, live, deps);
    try {
      const [row] = await db.select().from(s.contents).where(eq(s.contents.id, r.contentId));
      expect(row).toMatchObject({ status: "intake", sourceType: "paste", parserVersion: "v1" });
      const [job] = await db.select().from(s.ingestJobs).where(eq(s.ingestJobs.id, r.jobId!));
      expect(job).toMatchObject({ stage: "parsed", status: "queued" });
      expect((job!.cursor as { doc: { text: string } }).doc.text).toBe(text);
      const again = await intake({ kind: "paste", text }, live, deps);
      expect(again).toMatchObject({ contentId: r.contentId, jobId: r.jobId, reused: true });
    } finally {
      await db.delete(s.contents).where(eq(s.contents.id, r.contentId));
    }
  }, 30_000);
});
