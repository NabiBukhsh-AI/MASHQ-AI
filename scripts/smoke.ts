#!/usr/bin/env tsx
/**
 * Production smoke check.
 *
 * Read only and unauthenticated. It answers one question: is the deployment healthy enough to
 * demo right now. It deliberately does not sign in or create a session, so it can run on a
 * schedule without filling the database with probe rows or spending model credit.
 *
 *   pnpm smoke --url https://<your-app>.vercel.app
 */

interface Check {
  name: string;
  run: (base: string) => Promise<{ ok: boolean; detail: string }>;
}

async function get(base: string, path: string, init?: RequestInit) {
  return fetch(new URL(path, base), {
    redirect: "manual",
    headers: { "user-agent": "mashq-smoke" },
    ...init,
  });
}

const CHECKS: Check[] = [
  {
    name: "ping responds",
    run: async (base) => {
      const started = performance.now();
      const res = await get(base, "/api/ping");
      const ms = Math.round(performance.now() - started);
      return { ok: res.status === 200, detail: `${res.status} in ${ms} ms` };
    },
  },
  {
    name: "security headers present",
    run: async (base) => {
      const res = await get(base, "/login");
      const nosniff = res.headers.get("x-content-type-options");
      const csp =
        res.headers.get("content-security-policy") ??
        res.headers.get("content-security-policy-report-only");
      const hsts = res.headers.get("strict-transport-security");
      const ok = nosniff === "nosniff" && Boolean(csp);
      return {
        ok,
        detail: `nosniff=${nosniff ?? "missing"} csp=${csp ? "set" : "missing"} hsts=${hsts ? "set" : "missing"}`,
      };
    },
  },
  {
    name: "login page renders",
    run: async (base) => {
      const res = await get(base, "/login");
      const body = await res.text();
      const ok = res.status === 200 && /sign in/i.test(body);
      return { ok, detail: `${res.status}, ${body.length} bytes` };
    },
  },
  {
    name: "private routes refuse anonymous callers",
    run: async (base) => {
      const paths = ["/api/progress", "/api/analytics/summary", "/api/admin/config"];
      const results = await Promise.all(paths.map((p) => get(base, p)));
      // A redirect to login is as good as a 401 here; what matters is that no data comes back.
      const ok = results.every((r) => [401, 403, 302, 307].includes(r.status));
      return { ok, detail: results.map((r, i) => `${paths[i]}=${r.status}`).join(" ") };
    },
  },
  {
    name: "the retention cron refuses an unauthenticated call",
    run: async (base) => {
      const res = await get(base, "/api/cron/retention");
      return { ok: [401, 403].includes(res.status), detail: String(res.status) };
    },
  },
  {
    name: "no model identifier leaks on a public page",
    run: async (base) => {
      const res = await get(base, "/login");
      const body = await res.text();
      const leaked = /claude-[a-z0-9-]+|gemini-[0-9]/i.exec(body);
      return { ok: !leaked, detail: leaked ? `found ${leaked[0]}` : "none" };
    },
  },
];

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const base = argValue("--url") ?? process.env.EVAL_BASE_URL;
  if (!base) {
    throw new Error("Give a deployment: pnpm smoke --url https://<app>.vercel.app");
  }
  console.log(`smoke checking ${base}`);

  const rows: Array<Record<string, unknown>> = [];
  for (const check of CHECKS) {
    try {
      const result = await check.run(base);
      rows.push({ check: check.name, ok: result.ok, detail: result.detail });
    } catch (err) {
      rows.push({
        check: check.name,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.table(rows);
  const failed = rows.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed: ${failed.map((r) => r.check).join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nall smoke checks passed");
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

export {};
