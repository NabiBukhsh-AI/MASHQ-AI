import { redirect } from "next/navigation";
import { homeFor, requireSession, type Role } from "@/server/auth/guards";
import { AppShell } from "@/client/components/AppShell";
import { CapabilitiesProvider } from "@/client/session/Capabilities";

const ALLOWED: Role[] = ["ld_manager", "admin"];

// Role gate for every page in this group. Server-side, so a direct URL cannot bypass it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!ALLOWED.includes(session.role)) redirect(homeFor(session.role));

  // Managers and admins may always add content, so this does not read the learner flag. The
  // provider still has to be here: without it useCapabilities defaults to hiding, and the
  // library page would render an intake with no way to use it.
  return (
    <AppShell user={{ name: session.name, role: session.role }}>
      <CapabilitiesProvider value={{ role: session.role, canUpload: true }}>
        {children}
      </CapabilitiesProvider>
    </AppShell>
  );
}
