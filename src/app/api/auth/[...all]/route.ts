import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";
import { withHandler } from "@/server/http/handler";

// Better Auth owns these endpoints (sign in, sign out, get session). Sign-up is
// disabled in the auth config. Wrapped so they get request ids and JSON logs.
const handlers = toNextJsHandler(auth);

export const GET = withHandler({ auth: "public" }, (req) => handlers.GET(req));
export const POST = withHandler({ auth: "public", rateLimit: "auth" }, (req) => handlers.POST(req));
