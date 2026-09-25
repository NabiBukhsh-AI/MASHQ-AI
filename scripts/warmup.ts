#!/usr/bin/env tsx
/**
 * Warm up a deployment before a demo.
 *
 * Neon scales to zero after five idle minutes and Vercel functions cold start, so the first
 * request of a demo session is the slowest one anybody will see. This makes those requests
 * happen before the audience is watching, and reports the timings so a slow path is visible
 * rather than discovered live.
 *
 *   pnpm warmup --url https://<your-app>.vercel.app
 */

interface Probe {
  path: string;
  label: string;
  /** Not every path is reachable without a session; a 401 still proves it is warm. */
  acceptable: number[];
}

const PROBES: Probe[] = [
  { path: "/api/ping", label: "ping (must not touch the database)", acceptable: [200] },
  { path: "/login", label: "login page", acceptable: [200] },
  { path: "/api/health?deep=1", label: "deep health (wakes Neon)", acceptable: [200, 401, 403] },
  { path: "/learn", label: "learner shell", acceptable: [200, 302, 307, 401] },
  { path: "/manage", label: "manager shell", acceptable: [200, 302, 307, 401, 403] },
  { path: "/admin", label: "admin shell", acceptable: [200, 302, 307, 401, 403] },
];

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function probe(base: string, p: Probe): Promise<Record<string, unknown>> {
  const started = performance.now();
  try {
    const res = await fetch(new URL(p.path, base), {
      redirect: "manual",
      headers: { "user-agent": "mashq-warmup" },
    });
    const ms = Math.round(performance.now() - started);
    return {
      path: p.path,
      label: p.label,
      status: res.status,
      ms,
      ok: p.acceptable.includes(res.status),
    };
  } catch (err) {
    return {
      path: p.path,
      label: p.label,
      status: "error",
      ms: Math.round(performance.now() - started),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const base = argValue("--url") ?? process.env.EVAL_BASE_URL;
  if (!base) {
    throw new Error("Give a deployment: pnpm warmup --url https://<app>.vercel.app");
  }
  const rounds = Number(argValue("--rounds") ?? 2);

  console.log(`warming ${base}`);
  let allOk = true;

  for (let round = 1; round <= rounds; round++) {
    // Sequential, not parallel: the point is to wake things, and a burst of parallel cold
    // requests is a worse test of whether the second one is fast.
    const rows: Array<Record<string, unknown>> = [];
    for (const p of PROBES) rows.push(await probe(base, p));

    console.log(`\nround ${round} of ${rounds}`);
    console.table(rows);
    if (rows.some((r) => !r.ok)) allOk = false;

    const ping = rows.find((r) => r.path === "/api/ping");
    if (round === rounds && ping && Number(ping.ms) > 1500) {
      console.warn(
        `ping took ${ping.ms} ms on the final round; expected well under 1500 ms once warm`,
      );
    }
  }

  if (!allOk) {
    console.error("\nat least one probe did not return an acceptable status");
    process.exitCode = 1;
  } else {
    console.log("\nwarm: every probe returned an acceptable status");
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
