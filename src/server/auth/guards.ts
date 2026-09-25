import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ROLES, type Role } from "../db/schema/identity";
import { errors } from "../http/errors";
import { log } from "../obs/logger";

export type { Role };

export interface Session {
  userId: string;
  orgId: string;
  role: Role;
  pseudonym?: string;
  name: string;
  email: string;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Resolve the signed-in user from the request cookies (database session lookup,
 * no cookie cache). A user with no organization or an unknown role is treated
 * as signed out: every tenant query needs both.
 */
export async function resolveSession(req: Request): Promise<Session | null> {
  const { auth } = await import("./auth");
  const result = await auth.api.getSession({ headers: req.headers });
  if (!result) return null;
  const u = result.user as typeof result.user & {
    orgId?: string | null;
    role?: string | null;
    pseudonym?: string | null;
  };
  if (!u.orgId || !isRole(u.role)) {
    log.warn({ event: "session_without_tenant", userId: u.id });
    return null;
  }
  return {
    userId: u.id,
    orgId: u.orgId,
    role: u.role,
    pseudonym: u.pseudonym ?? undefined,
    name: u.name,
    email: u.email,
  };
}

/** For server components and server actions: the current session or null. */
export async function getSession(): Promise<Session | null> {
  const h = await headers();
  return resolveSession(new Request("http://local/session", { headers: h }));
}

/** Server components: redirect to login when signed out. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export function requireRole(session: Session, ...roles: Role[]): Session {
  if (!roles.includes(session.role)) throw errors.forbidden();
  return session;
}

/** Where each role lands after sign-in. */
export function homeFor(role: Role): string {
  return role === "admin" ? "/admin" : role === "ld_manager" ? "/manage" : "/learn";
}
