import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/env";
import * as schema from "./schema";

// Neon HTTP driver: one round trip per query, no pooling to manage, scales to zero.
export const db = drizzle(neon(env.DATABASE_URL), { schema });
export type Db = typeof db;
