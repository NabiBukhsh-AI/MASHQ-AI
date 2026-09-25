import { redirect } from "next/navigation";
import { homeFor, requireSession, type Role } from "@/server/auth/guards";
import { AppShell } from "@/client/components/AppShell";

const ALLOWED: Role[] = ["admin"];

// Role gate for every page in this group. Server-side, so a direct URL cannot bypass it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!ALLOWED.includes(session.role)) redirect(homeFor(session.role));
  return <AppShell user={{ name: session.name, role: session.role }}>{children}</AppShell>;
}
