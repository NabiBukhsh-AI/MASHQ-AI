import { date, index, integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tz, updatedAt } from "./common";
import { organizations, user } from "./identity";
import { learningSessions } from "./learning";

/** Append-only. */
export const xpLedger = pgTable(
  "xp_ledger",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => learningSessions.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    reasonCode: text("reason_code").notNull(),
    refId: text("ref_id"),
    createdAt: createdAt(),
  },
  (t) => [index("xp_ledger_user_created_idx").on(t.userId, t.createdAt)],
);

export const badges = pgTable("badges", {
  id: id(),
  code: text("code").notNull().unique("badges_code_uq"),
  name: text("name").notNull(),
  nameUr: text("name_ur"),
  description: text("description").notNull(),
  criteria: jsonb("criteria").$type<Record<string, unknown>>().notNull(),
});

export const userBadges = pgTable(
  "user_badges",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => badges.id, { onDelete: "cascade" }),
    awardedAt: tz("awarded_at").defaultNow().notNull(),
    evidenceRef: text("evidence_ref"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeId] })],
);

export const streaks = pgTable("streaks", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  currentDays: integer("current_days").notNull().default(0),
  longestDays: integer("longest_days").notNull().default(0),
  lastActiveDate: date("last_active_date"),
  freezesLeft: integer("freezes_left").notNull().default(0),
  updatedAt: updatedAt(),
});
