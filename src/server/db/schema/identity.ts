import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tz, updatedAt } from "./common";

export const ROLES = ["admin", "ld_manager", "learner"] as const;
export type Role = (typeof ROLES)[number];

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

// Better Auth tables. JS keys must stay as Better Auth names them (emailVerified,
// userId, ...); SQL column names are ours. Extra user fields are server-set only.
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    orgId: uuid("org_id").references(() => organizations.id),
    role: text("role", { enum: ROLES }).notNull().default("learner"),
    department: text("department"),
    cohort: text("cohort"),
    personaId: text("persona_id"),
    pseudonym: text("pseudonym"),
    isSeeded: boolean("is_seeded").notNull().default(false),
  },
  (t) => [uniqueIndex("user_email_uq").on(t.email), index("user_org_role_idx").on(t.orgId, t.role)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("session_token_uq").on(t.token), index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Seeded reference copy; the canonical map is server/auth/permissions.ts. */
export const roles = pgTable("roles", {
  id: text("id", { enum: ROLES }).primaryKey(),
  permissions: jsonb("permissions").$type<string[]>().notNull(),
});
