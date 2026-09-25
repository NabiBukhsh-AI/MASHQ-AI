import { NextResponse } from "next/server";
import crypto from "node:crypto";
import type { ZodType } from "zod";
import { env } from "@/env";
import { log } from "../obs/logger";
import { requestContext, type RequestContext } from "../obs/request-context";
import { resolveSession, type Role, type Session } from "../auth/guards";
import { AppError, errors, type ErrorDetail } from "./errors";
import type { RuleName } from "./rate-limit";
import { assertSameOrigin } from "../security/origin";

export type { Role, Session, RuleName };
export type AuthMode = "public" | "session" | "cron" | "health";

export interface HandlerOptions<B, Q> {
  auth: AuthMode;
  roles?: Role[];
  rateLimit?: RuleName;
  body?: ZodType<B>;
  query?: ZodType<Q>;
}

type Params = Record<string, string | string[] | undefined>;
type RouteContext = { params?: Promise<Params> };

export interface HandlerContext<B, Q> {
  requestId: string;
  body: B;
  query: Q;
  params: Promise<Params>;
  session: Session | null;
}

export type Handler<B, Q> = (req: Request, ctx: HandlerContext<B, Q>) => Promise<Response>;

const GENERIC_500 =
  "Something went wrong on our side. Try again, and quote the request id if it persists.";
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

function timingSafeEqual(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function zodDetails(issues: { path: PropertyKey[]; message: string }[]): ErrorDetail[] {
  return issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

function withRequestId(res: Response, requestId: string): Response {
  try {
    res.headers.set("x-request-id", requestId);
    return res;
  } catch {
    // Immutable headers (redirects, fetch passthrough): copy first.
    const copy = new Response(res.body, res);
    copy.headers.set("x-request-id", requestId);
    return copy;
  }
}

function errorResponse(e: unknown, requestId: string): Response {
  if (e instanceof AppError) {
    return NextResponse.json(
      { error: { code: e.code, message: e.publicMessage, requestId, details: e.details } },
      { status: e.status, headers: e.headers },
    );
  }
  // Stack and message stay in the log; the client gets a generic line.
  log.error({ event: "request_error", err: e });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: GENERIC_500, requestId } },
    { status: 500 },
  );
}

async function authorize(
  req: Request,
  opts: HandlerOptions<unknown, unknown>,
): Promise<Session | null> {
  switch (opts.auth) {
    case "public":
      return null;
    case "health":
      if (!timingSafeEqual(req.headers.get("x-health-token"), env.HEALTH_TOKEN)) {
        throw errors.unauthorized("Health token missing or wrong.");
      }
      return null;
    case "cron": {
      const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
      if (!timingSafeEqual(bearer, env.CRON_SECRET)) {
        throw errors.unauthorized("Cron secret missing or wrong.");
      }
      return null;
    }
    case "session": {
      const session = await resolveSession(req);
      if (!session) throw errors.unauthorized();
      if (opts.roles && !opts.roles.includes(session.role)) throw errors.forbidden();
      return session;
    }
  }
}

async function parseBody<B>(req: Request, schema: ZodType<B>): Promise<B> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw errors.badRequest("Send a JSON body.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw errors.badRequest("Check the highlighted fields.", zodDetails(parsed.error.issues));
  }
  return parsed.data;
}

function parseQuery<Q>(req: Request, schema: ZodType<Q>): Q {
  const raw = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw errors.badRequest("Check the query parameters.", zodDetails(parsed.error.issues));
  }
  return parsed.data;
}

/**
 * Wrap a route handler with request id, structured logging, auth, rate limit,
 * input validation and error mapping. Every API route goes through this; the
 * `guard` property carries the options for the route manifest test.
 */
export function withHandler<B = undefined, Q = undefined>(
  opts: HandlerOptions<B, Q>,
  fn: Handler<B, Q>,
) {
  if (opts.roles && opts.auth !== "session") {
    throw new Error('withHandler: `roles` requires auth: "session"');
  }
  const wrapped = async (req: Request, route?: RouteContext): Promise<Response> => {
    const incoming = req.headers.get("x-request-id");
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    const ctx: RequestContext = { requestId };
    const started = performance.now();
    const path = new URL(req.url).pathname;

    return requestContext.run(ctx, async () => {
      log.info({ event: "request_start", method: req.method, path });
      let status = 500;
      try {
        assertSameOrigin(req);
        const session = await authorize(req, opts as HandlerOptions<unknown, unknown>);
        if (session) {
          Object.assign(ctx, { userId: session.userId, orgId: session.orgId, role: session.role });
        }

        if (opts.rateLimit) {
          const { limit } = await import("../security/ratelimit");
          const rateResult = await limit(opts.rateLimit, session?.userId ?? clientIp(req));
          if (!rateResult.ok) {
            const retryAfterSeconds = Math.max(1, Math.ceil(rateResult.resetMs / 1000));
            throw errors.tooManyRequests(retryAfterSeconds);
          }
        }

        const query = (opts.query ? parseQuery(req, opts.query) : undefined) as Q;
        const body = (opts.body ? await parseBody(req, opts.body) : undefined) as B;

        const res = await fn(req, {
          requestId,
          body,
          query,
          params: route?.params ?? Promise.resolve({}),
          session,
        });
        status = res.status;
        return withRequestId(res, requestId);
      } catch (e) {
        const res = errorResponse(e, requestId);
        status = res.status;
        return withRequestId(res, requestId);
      } finally {
        log.info({
          event: "request_end",
          method: req.method,
          path,
          status,
          durationMs: Math.round(performance.now() - started),
        });
      }
    });
  };
  return Object.assign(wrapped, { guard: opts as HandlerOptions<unknown, unknown> });
}
