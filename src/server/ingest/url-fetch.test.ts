import { describe, it, expect, vi } from "vitest";
import { isPublicAddress, safeFetch, type SafeFetchOptions } from "./url-fetch";
import { AppError } from "../http/errors";

type FetchImpl = NonNullable<SafeFetchOptions["fetchImpl"]>;

// Public-looking hostnames resolve to whatever the test says; the fake fetch
// answers per URL. No network is touched.
function setup(
  routes: Record<string, () => Response>,
  dnsMap: Record<string, string[]> = {
    "example.com": ["93.184.216.34"],
    "evil.test": ["10.0.0.5"],
  },
) {
  const seen: string[] = [];
  const fetchImpl = vi.fn(async (input: unknown) => {
    const url = String(input);
    seen.push(url);
    const route = routes[url] ?? routes[new URL(url).origin + new URL(url).pathname];
    if (!route) throw new Error(`no fake route for ${url}`);
    return route();
  }) as unknown as FetchImpl;
  const lookup = vi.fn(async (host: string) => {
    const a = dnsMap[host];
    if (!a) throw new Error("ENOTFOUND");
    return a;
  });
  const opts: SafeFetchOptions = {
    timeoutMs: 5_000,
    maxBytes: 3_000_000,
    maxRedirects: 3,
    lookup,
    fetchImpl,
  };
  return { opts, seen, fetchImpl, lookup };
}

const html = (body: string, extra: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...extra },
  });

async function blocked(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(400);
  expect((err as AppError).publicMessage).toMatch(re);
}

describe("isPublicAddress", () => {
  it.each([
    ["127.0.0.1", false],
    ["::1", false],
    ["169.254.169.254", false],
    ["10.0.0.5", false],
    ["192.168.1.1", false],
    ["172.16.0.1", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["::ffff:10.0.0.5", false],
    ["::ffff:8.8.8.8", true],
    ["64:ff9b::a00:5", false],
    ["64:ff9b::808:808", true],
    ["fc00::1", false],
    ["fe80::1", false],
    ["2606:4700::1111", true],
    ["93.184.216.34", true],
    ["not-an-ip", false],
  ])("%s -> %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("safeFetch: blocked targets", () => {
  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://0x7f000001/",
    "http://[::ffff:10.0.0.5]/",
    "http://2130706433/",
  ])("%s is refused before any request", async (url) => {
    const { opts, fetchImpl } = setup({});
    await blocked(safeFetch(url, opts), /private or internal network/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses file:, credentials and non-standard ports", async () => {
    const { opts } = setup({});
    await blocked(safeFetch("file:///etc/passwd", opts), /Only http and https/);
    await blocked(safeFetch("http://user:pw@example.com/", opts), /username or password/);
    await blocked(safeFetch("http://example.com:8080/", opts), /standard web ports/);
  });

  it("refuses a public-looking hostname that resolves to a private address (rebinding)", async () => {
    const { opts, fetchImpl } = setup({});
    await blocked(safeFetch("http://evil.test/", opts), /private or internal network/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a public redirect to a private address", async () => {
    const { opts, seen } = setup({
      "http://example.com/go": () =>
        new Response(null, { status: 302, headers: { location: "http://10.0.0.5/admin" } }),
    });
    await blocked(safeFetch("http://example.com/go", opts), /private or internal network/);
    expect(seen).toEqual(["http://example.com/go"]);
  });

  it("stops after maxRedirects hops", async () => {
    const { opts } = setup({
      "http://example.com/1": () =>
        new Response(null, { status: 301, headers: { location: "/2" } }),
      "http://example.com/2": () =>
        new Response(null, { status: 301, headers: { location: "/3" } }),
      "http://example.com/3": () =>
        new Response(null, { status: 301, headers: { location: "/4" } }),
      "http://example.com/4": () =>
        new Response(null, { status: 301, headers: { location: "/5" } }),
    });
    await blocked(safeFetch("http://example.com/1", opts), /redirects too many times/);
  });

  it("refuses a 20 MB response, by declared length and by streamed bytes", async () => {
    const { opts } = setup({
      "http://example.com/declared": () =>
        html("x", { "content-length": String(20 * 1024 * 1024) }),
      "http://example.com/streamed": () => {
        const chunk = new Uint8Array(1024 * 1024);
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(c) {
            if (sent >= 20) return c.close();
            sent++;
            c.enqueue(chunk);
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/html" } });
      },
    });
    await blocked(safeFetch("http://example.com/declared", opts), /larger than the 3 MB limit/);
    await blocked(safeFetch("http://example.com/streamed", opts), /larger than the 3 MB limit/);
  });

  it("refuses disallowed content types and HTTP errors with readable messages", async () => {
    const { opts } = setup({
      "http://example.com/zip": () =>
        new Response("PK", { status: 200, headers: { "content-type": "application/zip" } }),
      "http://example.com/missing": () => new Response("nope", { status: 404 }),
    });
    await blocked(safeFetch("http://example.com/zip", opts), /Only web pages, PDFs and plain text/);
    await blocked(safeFetch("http://example.com/missing", opts), /HTTP 404/);
  });

  it("honours block and allow domain lists", async () => {
    const { opts } = setup({ "http://example.com/": () => html("<p>hi</p>") });
    await blocked(
      safeFetch("http://example.com/", { ...opts, blockDomains: ["example.com"] }),
      /blocked by your organization/,
    );
    await blocked(
      safeFetch("http://example.com/", { ...opts, allowDomains: ["bank.example"] }),
      /not on your organization's allowed list/,
    );
    await expect(
      safeFetch("http://example.com/", { ...opts, allowDomains: ["*.example.com", "example.com"] }),
    ).resolves.toBeTruthy();
  });

  it("does not let a trailing dot bypass the block list", async () => {
    const { opts, fetchImpl } = setup(
      { "http://example.com./": () => html("<p>hi</p>") },
      { "example.com.": ["93.184.216.34"], "example.com": ["93.184.216.34"] },
    );
    await blocked(
      safeFetch("http://example.com./", { ...opts, blockDomains: ["example.com"] }),
      /blocked by your organization/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an unknown host readably", async () => {
    const { opts } = setup({});
    await blocked(safeFetch("http://nope.invalid/", opts), /could not be found/);
  });
});

describe("safeFetch: allowed targets", () => {
  it("fetches a public HTML page and follows a same-site redirect, pinning each hop", async () => {
    const { opts, seen, lookup } = setup({
      "http://example.com/old": () =>
        new Response(null, { status: 301, headers: { location: "https://example.com/new" } }),
      "https://example.com/new": () => html("<html><body><p>Hello</p></body></html>"),
    });
    const r = await safeFetch("http://example.com/old", opts);
    expect(r.finalUrl).toBe("https://example.com/new");
    expect(r.contentType).toBe("text/html");
    expect(r.charset).toBe("utf-8");
    expect(new TextDecoder().decode(r.bytes)).toContain("Hello");
    expect(seen).toEqual(["http://example.com/old", "https://example.com/new"]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("fetches a public PDF", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 fake");
    const { opts } = setup({
      "https://example.com/doc.pdf": () =>
        new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
    });
    const r = await safeFetch("https://example.com/doc.pdf", opts);
    expect(r.contentType).toBe("application/pdf");
    expect(r.bytes.slice(0, 5)).toEqual(pdf.slice(0, 5));
  });

  it("passes a pinned dispatcher and manual redirects to fetch", async () => {
    const { opts, fetchImpl } = setup({ "https://example.com/": () => html("<p>x</p>") });
    await safeFetch("https://example.com/", opts);
    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1] as {
      redirect?: string;
      dispatcher?: unknown;
    };
    expect(init.redirect).toBe("manual");
    expect(init.dispatcher).toBeDefined();
  });
});
