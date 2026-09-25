import { NextResponse } from "next/server";
import { z } from "zod";
import { ParsedDocSchema } from "@/lib/parse";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { getOrgConfig } from "@/server/config/service";
import {
  intake,
  readable,
  tooLarge,
  withParseTimeout,
  type IntakeActor,
} from "@/server/ingest/intake";

// Bodies over 4.5 MB never reach a Vercel function; the config cap (4 MB) is
// enforced inside intake. Multipart is read here; JSON kinds are validated with Zod.
/**
 * The language the material is written in. Auto leaves it to detection at the prepare stage;
 * anything else is the uploader telling us, and wins. It becomes the default practice
 * language for sessions on this document, and the practice language is what routes speech to a
 * voice that can say it (English, Urdu, or Roman Urdu rendered for an Urdu voice).
 */
const ContentLanguage = z.enum(["auto", "en", "ur", "ur-Latn"]).default("auto");
type ContentLanguage = z.infer<typeof ContentLanguage>;

const JsonBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("paste"),
    title: z.string().max(300).optional(),
    text: z.string().min(1),
    language: ContentLanguage,
  }),
  z.object({ kind: z.literal("url"), url: z.url(), language: ContentLanguage }),
  z.object({
    kind: z.literal("parsed"),
    doc: ParsedDocSchema,
    sourceUrl: z.url().optional(),
    language: ContentLanguage,
  }),
]);

/**
 * Records the uploader's language on the content, after intake. Done here rather than inside
 * intake so it also applies when intake reuses an existing document with the same text: the
 * uploader saying "this is Urdu" should hold whether or not the text was seen before.
 */
async function applyLanguage<T extends { contentId: string }>(
  result: T,
  language: ContentLanguage,
  orgId: string,
): Promise<T & { language: string | null }> {
  if (language === "auto") return { ...result, language: null };
  const { db } = await import("@/server/db/client");
  const { contents } = await import("@/server/db/schema");
  const { and, eq } = await import("drizzle-orm");
  await db
    .update(contents)
    .set({ langPrimary: language })
    .where(and(eq(contents.id, result.contentId), eq(contents.orgId, orgId)));
  return { ...result, language };
}

/** Decode with the declared charset when the runtime knows it; UTF-8 otherwise. */
function decodeText(bytes: Uint8Array, charset?: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export const POST = withHandler({ auth: "session", rateLimit: "ingest" }, async (req, ctx) => {
  const session = ctx.session!;
  const actor: IntakeActor = { orgId: session.orgId, userId: session.userId, role: session.role };
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => {
      throw errors.badRequest("The upload was not readable. Try the file again.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw errors.badRequest("Attach a file in the `file` field.");
    if (file.size > 4 * 1024 * 1024) throw tooLarge(4);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const language = ContentLanguage.safeParse(form.get("language") ?? undefined);
    if (!language.success) throw errors.badRequest("Choose Auto, English, Urdu or Roman Urdu.");
    return NextResponse.json(
      await applyLanguage(
        await intake({ kind: "upload", bytes, mimeType: file.type, filename: file.name }, actor),
        language.data,
        actor.orgId,
      ),
    );
  }

  if (!contentType.includes("application/json")) {
    throw errors.badRequest("Send a file as multipart/form-data or a JSON body.");
  }
  const json = await req.json().catch(() => {
    throw errors.badRequest("Send a JSON body.");
  });
  const parsed = JsonBody.safeParse(json);
  if (!parsed.success) {
    throw errors.badRequest(
      "Check the request body.",
      parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    );
  }
  const body = parsed.data;

  if (body.kind === "url") {
    const { config } = await getOrgConfig(actor.orgId);
    if (!config.content.url.enabled || !config.content.allowedTypes.includes("url")) {
      throw errors.badRequest(
        "Importing from a link is turned off for this organization. Paste the text instead.",
      );
    }
    // Same gate intake applies, but before the server makes any outbound request.
    if (actor.role === "learner" && !config.content.learnerUploads) {
      throw errors.forbidden(
        "Learner uploads are turned off for this organization. Ask an L&D manager to add the content.",
      );
    }
    const { safeFetch } = await import("@/server/ingest/url-fetch");
    const { parseFile, parseHtml } = await import("@/lib/parse");
    const fetched = await safeFetch(body.url, {
      timeoutMs: config.content.url.timeoutMs,
      maxBytes: config.content.url.maxBytes,
      maxRedirects: config.content.url.maxRedirects,
      allowDomains: config.content.url.allowDomains,
      blockDomains: config.content.url.blockDomains,
    });
    const limits = { maxPages: config.content.maxPages, maxSlides: config.content.maxSlides };
    const doc = await readable(() =>
      withParseTimeout(
        fetched.contentType === "application/pdf"
          ? parseFile(fetched.bytes, "application/pdf", "download.pdf", limits)
          : fetched.contentType.startsWith("text/") && fetched.contentType !== "text/html"
            ? parseFile(fetched.bytes, fetched.contentType, "download.txt", limits)
            : Promise.resolve(
                parseHtml(decodeText(fetched.bytes, fetched.charset), fetched.finalUrl),
              ),
      ),
    );
    return NextResponse.json(
      await applyLanguage(
        await intake({ kind: "parsed", doc, sourceUrl: fetched.finalUrl }, actor),
        body.language,
        actor.orgId,
      ),
    );
  }

  if (body.kind === "paste") {
    return NextResponse.json(
      await applyLanguage(
        await intake({ kind: "paste", text: body.text, title: body.title }, actor),
        body.language,
        actor.orgId,
      ),
    );
  }
  return NextResponse.json(
    await applyLanguage(
      await intake({ kind: "parsed", doc: body.doc, sourceUrl: body.sourceUrl }, actor),
      body.language,
      actor.orgId,
    ),
  );
});
