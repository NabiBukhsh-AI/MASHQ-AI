import dns from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { AppError, errors } from "../http/errors";

// SSRF guard. Every hop: scheme, credentials, port, hostname
// resolution and address class are checked, and the validated address is pinned
// into the socket connect so a second DNS answer (rebinding) cannot swap it.

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  allowDomains?: string[];
  blockDomains?: string[];
  /** Test seams. */
  lookup?: (hostname: string) => Promise<string[]>;
  fetchImpl?: typeof undiciFetch;
}

export interface SafeFetchResult {
  finalUrl: string;
  contentType: string;
  /** From the content-type header, when the server declared one. */
  charset?: string;
  bytes: Uint8Array;
}

export const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
] as const;

const BLOCKED_MESSAGE =
  "That address points to a private or internal network, which cannot be fetched. Use a public web page.";

const defaultLookup = async (hostname: string): Promise<string[]> => {
  const answers = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => a.address);
};

/** True when the address is a public unicast address, after unwrapping IPv4-mapped and NAT64 forms. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let addr = ipaddr.parse(address);
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
    else if (
      v6.parts[0] === 0x64 &&
      v6.parts[1] === 0xff9b &&
      v6.parts.slice(2, 6).every((p) => p === 0)
    ) {
      // NAT64 64:ff9b::/96 embeds an IPv4 address in the last 32 bits.
      const p6 = v6.parts[6]!;
      const p7 = v6.parts[7]!;
      addr = new ipaddr.IPv4([p6 >> 8, p6 & 0xff, p7 >> 8, p7 & 0xff]);
    }
  }
  if (addr.kind() === "ipv4") {
    const v4 = addr as ipaddr.IPv4;
    if (v4.range() !== "unicast") return false;
    // ipaddr.js does not classify 0.0.0.0/8 or the metadata host beyond linkLocal; be explicit.
    const [a] = v4.octets;
    if (a === 0) return false;
    if (v4.toString() === "169.254.169.254") return false;
    return true;
  }
  return addr.range() === "unicast";
}

function hostMatches(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => {
    const pat = p.toLowerCase().replace(/^\*\./, "");
    return h === pat || h.endsWith(`.${pat}`);
  });
}

/** Validate one URL (scheme, credentials, port, host lists) and resolve a pinned public address. */
async function validate(
  rawUrl: string,
  opts: SafeFetchOptions,
): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw errors.badRequest("That does not look like a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw errors.badRequest("Only http and https links can be fetched.");
  }
  if (url.username || url.password) {
    throw errors.badRequest("Links with a username or password in them cannot be fetched.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw errors.badRequest("Only the standard web ports (80 and 443) can be fetched.");
  }
  // Strip brackets and a trailing dot so list matching sees the canonical host.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw errors.badRequest("That does not look like a valid web address.");
  if (opts.blockDomains?.length && hostMatches(host, opts.blockDomains)) {
    throw errors.badRequest("That site is blocked by your organization's settings.");
  }
  if (opts.allowDomains?.length && !hostMatches(host, opts.allowDomains)) {
    throw errors.badRequest("That site is not on your organization's allowed list.");
  }

  let addresses: string[];
  if (ipaddr.isValid(host)) addresses = [host];
  else {
    try {
      addresses = await (opts.lookup ?? defaultLookup)(host);
    } catch {
      throw errors.badRequest(
        "That web address could not be found. Check the spelling and try again.",
      );
    }
  }
  if (!addresses.length || !addresses.every(isPublicAddress))
    throw errors.badRequest(BLOCKED_MESSAGE);
  return { url, address: addresses[0]! };
}

function pinnedAgent(address: string): Dispatcher {
  const family = ipaddr.parse(address).kind() === "ipv6" ? 6 : 4;
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      (callback as (err: null, addrs: { address: string; family: number }[]) => void)(null, [
        { address, family },
      ]);
    } else {
      callback(null, address, family);
    }
  };
  return new Agent({ connect: { lookup, timeout: 5_000 } });
}

/**
 * Fetch a public URL with the checks above, following at most `maxRedirects`
 * redirects and re-validating each hop, with a streamed byte cap and a
 * content-type allowlist. Throws AppError with user-readable messages.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const doFetch = opts.fetchImpl ?? undiciFetch;
  const deadline = AbortSignal.timeout(opts.timeoutMs);
  let current = rawUrl;

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const { url, address } = await validate(current, opts);
    const dispatcher = pinnedAgent(address);
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await doFetch(url, {
        redirect: "manual",
        signal: deadline,
        dispatcher,
        headers: {
          accept: ALLOWED_CONTENT_TYPES.join(", "),
          "user-agent": "Mashq/1.0 (+content import)",
        },
      });
    } catch {
      await dispatcher.close().catch(() => undefined);
      if (deadline.aborted)
        throw errors.badRequest(
          "That page took too long to respond. Try again later or paste the text.",
        );
      throw errors.badRequest("That page could not be reached. Check the link and try again.");
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      await dispatcher.close();
      if (!location)
        throw errors.badRequest(
          "That page redirected without saying where to. Try the final address directly.",
        );
      if (hop === opts.maxRedirects)
        throw errors.badRequest(
          "That link redirects too many times. Try the final address directly.",
        );
      current = new URL(location, url).toString();
      continue;
    }

    try {
      if (!res.ok) {
        throw errors.badRequest(
          `That page answered with an error (HTTP ${res.status}). Check the link or paste the text.`,
        );
      }
      const rawType = res.headers.get("content-type") ?? "";
      const contentType = rawType.split(";")[0]!.trim().toLowerCase();
      const charset = /charset=["']?([\w-]+)/i.exec(rawType)?.[1]?.toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_CONTENT_TYPES)[number])) {
        throw errors.badRequest("Only web pages, PDFs and plain text can be imported from a link.");
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > opts.maxBytes) throw tooBig(opts.maxBytes);

      const chunks: Uint8Array[] = [];
      let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw tooBig(opts.maxBytes);
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      return { finalUrl: url.toString(), contentType, charset, bytes };
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (deadline.aborted)
        throw errors.badRequest(
          "That page took too long to download. Try a smaller page or paste the text.",
        );
      throw errors.badRequest("That page could not be read. Try again or paste the text.");
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }
  throw errors.badRequest("That link redirects too many times. Try the final address directly.");
}

function tooBig(maxBytes: number): AppError {
  return errors.badRequest(
    `That page is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit. Paste the part you need instead.`,
  );
}
