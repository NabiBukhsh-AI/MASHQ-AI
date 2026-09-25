import { isPlainObject } from "./merge";

/** RFC 6902 operations, the subset a config diff needs. */
export type PatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown };

const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Diff two JSON values into a patch that turns `from` into `to`. Arrays are replaced whole. */
export function diff(from: unknown, to: unknown, path = ""): PatchOp[] {
  if (isPlainObject(from) && isPlainObject(to)) {
    const ops: PatchOp[] = [];
    for (const key of Object.keys(from)) {
      if (!(key in to)) ops.push({ op: "remove", path: `${path}/${escape(key)}` });
    }
    for (const [key, value] of Object.entries(to)) {
      const p = `${path}/${escape(key)}`;
      if (!(key in from)) ops.push({ op: "add", path: p, value });
      else ops.push(...diff(from[key], value, p));
    }
    return ops;
  }
  return JSON.stringify(from) === JSON.stringify(to)
    ? []
    : [{ op: "replace", path: path || "", value: to }];
}

/** One-line human summary for the live "settings updated" banner. */
export function summarize(ops: PatchOp[], max = 3): string {
  const parts = ops.slice(0, max).map((o) => {
    const key = o.path.split("/").filter(Boolean).join(".");
    return o.op === "remove" ? `${key} removed` : `${key} is now ${JSON.stringify(o.value)}`;
  });
  const more = ops.length > max ? ` and ${ops.length - max} more` : "";
  return parts.join(", ") + more;
}
