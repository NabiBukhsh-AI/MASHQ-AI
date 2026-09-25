import type { Role } from "./guards";

// The canonical permission map. The `roles` table holds a seeded copy for reference.
export const PERMISSIONS: Record<Role, readonly string[]> = {
  admin: [
    "content:read",
    "content:write",
    "session:own",
    "analytics:read",
    "export:read",
    "config:read",
    "config:write",
    "demo:reset",
    "system:read",
  ],
  ld_manager: ["content:read", "content:write", "session:own", "analytics:read", "export:read"],
  learner: ["content:read", "session:own"],
};

export type Permission = (typeof PERMISSIONS)[Role][number];

export function can(role: Role, permission: string): boolean {
  return PERMISSIONS[role].includes(permission);
}
