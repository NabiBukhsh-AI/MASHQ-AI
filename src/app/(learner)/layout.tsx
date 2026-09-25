import { redirect } from "next/navigation";
import { homeFor, requireSession, type Role } from "@/server/auth/guards";
import { getOrgConfig } from "@/server/config/service";
import { AppShell } from "@/client/components/AppShell";
import { CapabilitiesProvider } from "@/client/session/Capabilities";

const ALLOWED: Role[] = ["learner", "ld_manager", "admin"];

// Role gate for every page in this group. Server-side, so a direct URL cannot bypass it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!ALLOWED.includes(session.role)) redirect(homeFor(session.role));

  // Resolved here rather than fetched by the client, so the upload controls are never rendered
  // for someone the API would refuse. The route still refuses: this only stops the bad screen.
  const { config } = await getOrgConfig(session.orgId);
  const canUpload = session.role !== "learner" || config.content.learnerUploads;

  return (
    <AppShell user={{ name: session.name, role: session.role }}>
      <CapabilitiesProvider value={{ role: session.role, canUpload }}>
        {children}
      </CapabilitiesProvider>
    </AppShell>
  );
}
