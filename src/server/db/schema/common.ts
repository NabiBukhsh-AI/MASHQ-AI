import { customType, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "@/lib/ids";

export const EMBEDDING_DIMS = 768;

/** pgvector half-precision vector, stored as text on the wire. */
export const halfvec = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `halfvec(${EMBEDDING_DIMS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/** App-generated UUIDv7 primary key. */
export const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date());
export const tz = (name: string) => timestamp(name, { withTimezone: true });
