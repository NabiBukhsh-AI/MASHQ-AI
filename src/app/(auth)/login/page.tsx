import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/server/auth/guards";
import { signIn } from "./actions";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in | Mashq" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(homeFor(session.role));
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-6">
      <LoginForm action={signIn} error={error} />
    </main>
  );
}
